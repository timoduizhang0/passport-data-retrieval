import "./style.css";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

// 由 vite.config.ts 在构建时注入（格式：YYYY-MM-DD）
declare const __BUILD_DATE__: string;

// --- Types ---
interface PassportData {
  name_cn: string; gender: string; surname_en: string; given_en: string;
  doc_type: string; passport_no: string; client_type: string; nationality: string;
  dob: string; birth_place: string; issue_place: string; issue_date: string;
  expiry_date: string; country_code: string; phone: string;
}

interface PassportEntry {
  id: number;
  file: File;
  name: string;
  dataUrl: string;
  status: "pending" | "recognizing" | "done" | "error";
  data: PassportData | null;
  error: string | null;
}

// --- State ---
let entries: PassportEntry[] = [];
let idCounter = 0;
let exportHistory: { name: string; time: string; path: string }[] = [];
let isRecognizing = false;
let exportDir = localStorage.getItem("passport-ocr:export-dir") || "";

// --- Upload constraints ---
const ALLOWED_MIME = new Set(["image/png", "image/jpeg"]);
const ALLOWED_EXT = /\.(png|jpe?g)$/i;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// --- DOM refs ---
const $ = (id: string) => document.getElementById(id)!;
const fileInput = $("file-input") as HTMLInputElement;
const selectBtn = $("select-btn");
const addMoreBtn = $("add-more-btn");
const startAllBtn = $("start-all-btn") as HTMLButtonElement;
const uploadArea = $("upload-area");
const uploadProgress = $("upload-progress");
const uploadProgressBar = $("upload-progress-bar");
const uploadProgressText = $("upload-progress-text");
const uploadStatus = $("upload-status");
const previewGallery = $("preview-gallery");
const thumbnails = $("thumbnails");
const resultSection = $("result-section");
const resultBody = $("result-body");
const progressSection = $("progress-section");
const progressBar = $("progress-bar");
const progressText = $("progress-text");
const exportBtn = $("export-btn") as HTMLButtonElement;
const selectDirBtn = $("select-dir-btn");
const exportDirPath = $("export-dir-path");
const historySection = $("history-section");
const exportHistoryDiv = $("export-history");
const settingsBtn = $("settings-btn");
const settingsModal = $("settings-modal");
const modalCloseBtn = $("modal-close-btn");
const buildDateEl = $("build-date");

function getApiConfig() {
  return {
    apiKey: ($("api-key") as HTMLInputElement).value.trim(),
    apiUrl: ($("api-url") as HTMLInputElement).value.trim().replace(/\/+$/, ""),
    model: ($("model-name") as HTMLInputElement).value.trim(),
  };
}

// --- Persist API config ---
const CONFIG_KEYS = ["api-key", "api-url", "model-name"];
function loadApiConfig() {
  for (const id of CONFIG_KEYS) {
    const saved = localStorage.getItem("passport-ocr:" + id);
    if (saved) ($(id) as HTMLInputElement).value = saved;
  }
}
function saveApiConfig() {
  for (const id of CONFIG_KEYS) {
    const el = $(id) as HTMLInputElement;
    localStorage.setItem("passport-ocr:" + id, el.value);
  }
}

// --- File Selection ---
function selectFile() {
  const config = getApiConfig();
  if (!config.apiKey) { alert("请先填写 API Key"); return; }
  fileInput.click();
}

function handleFileInput(e: Event) {
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;
  const config = getApiConfig();
  if (!config.apiKey) { alert("请先填写 API Key"); return; }
  // 点击路径：快速处理，不显示进度条
  addFiles(files, { showProgress: false });
  fileInput.value = "";
}

// --- File Validation ---
function validateFile(file: File): { ok: true } | { ok: false; reason: string } {
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT.test(file.name)) {
    return { ok: false, reason: "仅支持 PNG / JPG" };
  }
  if (file.size > MAX_FILE_SIZE) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return { ok: false, reason: `文件过大(${mb}MB > 10MB)` };
  }
  return { ok: true };
}

// --- File Reading with Progress ---
function readFileAsDataUrlWithProgress(
  file: File,
  onProgress: (loaded: number, total: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
    };
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`读取失败: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// --- Add files (used by both click & drag-drop) ---
async function addFiles(
  files: FileList | File[],
  opts: { showProgress?: boolean } = {}
) {
  const list = Array.from(files);
  if (list.length === 0) return;

  const valid: File[] = [];
  const errors: { name: string; reason: string }[] = [];
  for (const f of list) {
    const v = validateFile(f);
    if (v.ok) valid.push(f);
    else errors.push({ name: f.name, reason: v.reason });
  }

  if (errors.length > 0) {
    const msg = errors
      .slice(0, 3)
      .map((e) => `• ${e.name}: ${e.reason}`)
      .join("\n") + (errors.length > 3 ? `\n... 共 ${errors.length} 个文件被跳过` : "");
    showUploadStatus("error", msg);
  }

  if (valid.length === 0) return;

  const showProgress = !!opts.showProgress;

  if (showProgress) {
    uploadProgress.classList.remove("hidden");
    uploadProgressBar.style.width = "0%";
    uploadProgressText.textContent = `0 / ${valid.length}`;
  }

  // 总体进度：按字节数累加，更平滑
  const totalBytes = valid.reduce((s, f) => s + f.size, 0);
  let loadedBytes = 0;
  let completedFiles = 0;

  try {
    for (const file of valid) {
      let dataUrl: string;
      if (showProgress) {
        dataUrl = await readFileAsDataUrlWithProgress(file, (loaded, total) => {
          const overall = loadedBytes + loaded;
          const pct = totalBytes > 0 ? Math.round((overall / totalBytes) * 100) : 0;
          uploadProgressBar.style.width = `${pct}%`;
        });
      } else {
        dataUrl = URL.createObjectURL(file);
      }
      entries.push({
        id: idCounter++,
        file,
        name: file.name,
        dataUrl,
        status: "pending",
        data: null,
        error: null,
      });
      loadedBytes += file.size;
      completedFiles++;
      if (showProgress) {
        uploadProgressBar.style.width = `${Math.round((loadedBytes / totalBytes) * 100)}%`;
        uploadProgressText.textContent = `${completedFiles} / ${valid.length}`;
      }
    }

    if (showProgress) {
      uploadProgressBar.style.width = "100%";
      // 进度条短暂保留后隐藏
      setTimeout(() => uploadProgress.classList.add("hidden"), 800);
    }

    if (errors.length === 0) {
      showUploadStatus("success", `✓ 已添加 ${valid.length} 个文件`);
    } else {
      showUploadStatus(
        "success",
        `✓ 已添加 ${valid.length} 个文件（${errors.length} 个被跳过，详见上方错误）`
      );
    }

    renderThumbnails();
    updateButtons();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showUploadStatus("error", `✗ 上传失败: ${msg}`);
    if (showProgress) uploadProgress.classList.add("hidden");
    console.error("Upload error:", err);
  }
}

// --- Upload status (success / error) ---
let statusTimer: number | null = null;
function showUploadStatus(kind: "success" | "error", message: string) {
  uploadStatus.classList.remove("hidden", "success", "error");
  uploadStatus.classList.add(kind);
  uploadStatus.textContent = message;
  if (statusTimer !== null) window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    uploadStatus.classList.add("hidden");
    statusTimer = null;
  }, 4000);
}

// --- Render ---
function renderThumbnails() {
  if (entries.length === 0) {
    previewGallery.classList.add("hidden");
    uploadArea.classList.remove("hidden");
    return;
  }
  uploadArea.classList.add("hidden");
  previewGallery.classList.remove("hidden");

  thumbnails.innerHTML = entries.map((e) => {
    const label = e.status === "pending" ? "待识别" : e.status === "recognizing" ? "识别中" : e.status === "done" ? "✓" : "✗";
    const disabled = e.status === "recognizing" ? "disabled" : "";
    return `<div class="thumb-item ${e.status}" data-id="${e.id}" title="${e.error ? '错误: ' + esc(e.error) : ''}">
      <img src="${e.dataUrl}" alt="${e.name}" />
      <button class="thumb-del" data-id="${e.id}" ${disabled} title="删除">×</button>
      <span class="thumb-status ${e.status}">${label}</span>
      <div class="thumb-name">${esc(e.name)}</div>
    </div>`;
  }).join("");
}

function renderTable() {
  const done = entries.filter((e) => e.status === "done" && e.data);
  if (done.length === 0) { resultSection.classList.add("hidden"); return; }
  resultSection.classList.remove("hidden");

  resultBody.innerHTML = done.map((e, idx) => {
    const d = e.data!;
    return `<tr>
      <td>${idx + 1}</td>
      <td>${esc(d.name_cn)}</td><td>${esc(d.gender)}</td>
      <td>${esc(d.surname_en)}</td><td>${esc(d.given_en)}</td>
      <td>${esc(d.passport_no)}</td><td>${esc(d.dob)}</td>
      <td>${esc(d.birth_place)}</td><td>${esc(d.issue_place)}</td>
      <td>${esc(d.issue_date)}</td><td>${esc(d.expiry_date)}</td>
      <td>${esc(d.country_code)}</td>
      <td><input type="text" class="phone-input" data-idx="${idx}" value="${esc(d.phone)}" placeholder="电话" /></td>
    </tr>`;
  }).join("");

  document.querySelectorAll(".phone-input").forEach((input) => {
    input.addEventListener("input", (ev) => {
      const idx = parseInt((ev.target as HTMLElement).dataset.idx!);
      const doneEntries = entries.filter((e) => e.status === "done" && e.data);
      if (doneEntries[idx]?.data) doneEntries[idx].data!.phone = (ev.target as HTMLInputElement).value;
    });
  });
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s; return d.innerHTML;
}

function updateButtons() {
  startAllBtn.disabled = isRecognizing || !entries.some((e) => e.status === "pending");
  exportBtn.disabled = isRecognizing || !entries.some((e) => e.status === "done" && e.data);
}

// --- Recognition ---
async function startAll() {
  const config = getApiConfig();
  if (!config.apiKey) { alert("请先填写 API Key"); return; }

  isRecognizing = true;
  updateButtons();
  progressSection.classList.remove("hidden");

  let completed = 0;
  let total = entries.filter((e) => e.status === "pending").length;
  updateProgress(completed, total);

  // 使用 while 循环每轮重新查找 pending 条目，
  // 这样识别过程中新上传的照片也会被自动纳入处理
  while (true) {
    const entry = entries.find((e) => e.status === "pending");
    if (!entry) break;

    entry.status = "recognizing";
    renderThumbnails();

    try {
      // Read file as base64
      const buffer = await entry.file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);

      const data = await invoke<PassportData>("recognize_passport_base64", {
        imageBase64: base64,
        apiKey: config.apiKey,
        apiUrl: config.apiUrl,
        model: config.model,
      });
      entry.data = data;
      entry.status = "done";
    } catch (err) {
      entry.status = "error";
      entry.error = String(err);
      console.error("Recognition error:", err);
    }

    completed++;
    // 每次完成后重新统计总待识别数，以便动态更新进度
    total = entries.filter((e) => e.status === "pending" || e.status === "recognizing").length + completed;
    updateProgress(completed, total);
    renderThumbnails();
    renderTable();
  }

  isRecognizing = false;
  updateButtons();

  const done = entries.filter((e) => e.status === "done");
  const errors = entries.filter((e) => e.status === "error");
  if (errors.length > 0) {
    const firstError = errors[0].error || "未知错误";
    alert(`识别完成！成功 ${done.length} 张，失败 ${errors.length} 张。\n\n失败原因: ${firstError}`);
  } else if (done.length > 0) {
    alert(`识别完成！共 ${done.length} 张全部成功。`);
  }
}

function updateProgress(completed: number, total: number) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  progressText.textContent = `${completed} / ${total}`;
}

// --- Export Directory ---
function renderExportDir() {
  if (exportDir) {
    exportDirPath.textContent = exportDir;
    exportDirPath.style.color = "var(--text)";
  } else {
    exportDirPath.textContent = "默认（程序目录/护照导出/）";
    exportDirPath.style.color = "var(--text-secondary)";
  }
}

async function selectExportDir() {
  const dir = await open({
    directory: true,
    multiple: false,
    title: "选择导出目录",
  });
  if (!dir) return; // 用户取消
  exportDir = dir;
  localStorage.setItem("passport-ocr:export-dir", dir);
  renderExportDir();
}

// --- Export ---
async function doExport() {
  const done = entries.filter((e) => e.status === "done" && e.data);
  if (done.length === 0) { alert("没有可导出的数据"); return; }

  document.querySelectorAll(".phone-input").forEach((input) => {
    const idx = parseInt((input as HTMLElement).dataset.idx!);
    const doneEntries = entries.filter((e) => e.status === "done" && e.data);
    if (doneEntries[idx]?.data) doneEntries[idx].data!.phone = (input as HTMLInputElement).value;
  });

  try {
    // 如果没有设置导出目录，先让用户选择
    if (!exportDir) {
      await selectExportDir();
      if (!exportDir) return; // 用户取消选择，不导出
    }

    const allData = done.map((e) => e.data!);
    const result = await invoke<string>("export_excel_batch", { dataList: allData, outputDir: exportDir });
    const time = new Date().toLocaleString("zh-CN");
    const names = allData.map((d) => d.name_cn || "?").join(", ");
    exportHistory.unshift({ name: names, time, path: result });
    exportHistoryDiv.innerHTML = exportHistory.map((h) =>
      `<div class="history-item"><span><strong>${esc(h.name)}</strong> — ${h.time}</span><span class="status-success">✓ ${h.path.split("\\").pop()}</span></div>`
    ).join("");
    historySection.classList.remove("hidden");
    alert(`导出成功！共 ${allData.length} 条记录。\n文件路径: ${result}`);
  } catch (e) {
    alert("导出失败: " + e);
    console.error(e);
  }
}

// --- Delete ---
function deleteEntry(id: number) {
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return;
  const removed = entries[idx];
  // 释放对象 URL 避免内存泄漏
  URL.revokeObjectURL(removed.dataUrl);
  entries.splice(idx, 1);
  renderThumbnails();
  renderTable();
  updateButtons();
}

// --- Event Binding ---
// 注意：selectBtn 是 uploadArea 的子元素，若两者都直接监听 click，
// 点击按钮时事件会冒泡到 uploadArea，导致 selectFile 被调用两次，
// 从而弹出两次文件选择框。这里阻止冒泡以避免重复触发。
selectBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  selectFile();
});
addMoreBtn.addEventListener("click", selectFile);
uploadArea.addEventListener("click", selectFile);
fileInput.addEventListener("change", handleFileInput);
startAllBtn.addEventListener("click", startAll);
exportBtn.addEventListener("click", doExport);
selectDirBtn.addEventListener("click", selectExportDir);

// --- Drag & Drop Upload ---
// 拖拽计数器：dragleave 在子元素上会反复触发，
// 用计数器保证只有真正离开整个区域时才取消高亮。
let dragDepth = 0;

function setDragOver(active: boolean, accept = true) {
  uploadArea.classList.remove("drag-over", "drag-error");
  if (active) uploadArea.classList.add(accept ? "drag-over" : "drag-error");
}

function containsFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  const types = Array.from(dt.types || []);
  if (types.includes("Files")) return true;
  // 某些 WebView2 实现不会暴露 "Files"，直接看 items
  return Array.from(dt.items || []).some((it) => it.kind === "file");
}

uploadArea.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  setDragOver(true, containsFiles(e.dataTransfer));
});

uploadArea.addEventListener("dragover", (e) => {
  // 必须阻止默认行为，否则浏览器/WebView 会拒绝 drop
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});

uploadArea.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDragOver(false, true);
});

uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragDepth = 0;
  setDragOver(false, true);
  const config = getApiConfig();
  if (!config.apiKey) { alert("请先填写 API Key"); return; }
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  addFiles(files, { showProgress: true });
});

// 防止拖出区域外的文件触发浏览器/WebView 默认行为
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  // 只有落在 uploadArea 外部时才阻止默认打开，
  // 落在内部时 uploadArea 的 drop 监听器已经 e.preventDefault()
  if (!uploadArea.contains(e.target as Node)) e.preventDefault();
});

// Esc 键取消拖拽高亮（仅当正处于拖拽中）
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && (uploadArea.classList.contains("drag-over") || uploadArea.classList.contains("drag-error"))) {
    dragDepth = 0;
    setDragOver(false, true);
  }
});

// 事件代理：点击缩略图上的删除按钮
thumbnails.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(".thumb-del") as HTMLElement | null;
  if (!btn) return;
  const id = parseInt(btn.dataset.id!);
  deleteEntry(id);
});

// --- Settings Modal ---
settingsBtn.addEventListener("click", () => {
  settingsModal.classList.remove("hidden");
});

function closeSettings() {
  settingsModal.classList.add("hidden");
}
modalCloseBtn.addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettings();
});
CONFIG_KEYS.forEach((id) => {
  $(id).addEventListener("change", saveApiConfig);
  $(id).addEventListener("blur", saveApiConfig);
});

// --- Init ---
loadApiConfig();
renderExportDir();
// 显示构建日期
buildDateEl.textContent = __BUILD_DATE__;
console.log("护照识别工具已启动");
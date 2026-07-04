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

// --- DOM refs ---
const $ = (id: string) => document.getElementById(id)!;
const fileInput = $("file-input") as HTMLInputElement;
const selectBtn = $("select-btn");
const addMoreBtn = $("add-more-btn");
const startAllBtn = $("start-all-btn");
const uploadArea = $("upload-area");
const previewGallery = $("preview-gallery");
const thumbnails = $("thumbnails");
const resultSection = $("result-section");
const resultBody = $("result-body");
const progressSection = $("progress-section");
const progressBar = $("progress-bar");
const progressText = $("progress-text");
const exportBtn = $("export-btn");
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

  for (const file of Array.from(files)) {
    entries.push({
      id: idCounter++,
      file,
      name: file.name,
      dataUrl: URL.createObjectURL(file),
      status: "pending",
      data: null,
      error: null,
    });
  }
  renderThumbnails();
  updateButtons();
  fileInput.value = "";
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
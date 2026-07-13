// 应用内更新检查（GitHub + jsDelivr CDN）
// 发版时更新 version.json 到 GitHub 仓库，客户端通过 jsDelivr 加速获取
// 点击"立即下载"后通过 Rust 后端流式下载安装包，监听进度事件实时显示

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface UpdateInfo {
  version: string;
  releaseDate: string;
  changelog: string;
  downloadUrl: string;
  mandatory: boolean;
}

// jsDelivr CDN URL（GitHub 公开仓库）
// 格式: https://cdn.jsdelivr.net/gh/<user>/<repo>@<branch>/<file>
const MANIFEST_URL =
  "https://cdn.jsdelivr.net/gh/timoduizhang0/passport-data-retrieval@main/version.json";

// 启动后延迟检查(ms)，不抢首屏
const STARTUP_DELAY_MS = 5000;
// 两次检查之间的最小间隔(ms)
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
// localStorage 键名
const LAST_CHECK_KEY = "passport-ocr:last-update-check";

// 模块级状态：保存待更新的信息，供界面上"更新"按钮随时调用
let pendingUpdate: UpdateInfo | null = null;
// 是否已注册进度事件监听
let progressUnsub: (() => void) | null = null;

/** 回调类型：当发现新版本时通知外部添加 UI 按钮 */
type UpdateCallback = (info: UpdateInfo) => void;
let onUpdateCb: UpdateCallback | null = null;

/**
 * 初始化自动更新检查。在应用启动后调用一次即可。
 * @param currentVersion 当前版本号，如 "1.0.0"
 * @param onUpdate 可选回调，当发现新版本时调用，可用于在界面上添加提示按钮
 */
export function initAutoUpdate(currentVersion: string, onUpdate?: UpdateCallback) {
  if (onUpdate) onUpdateCb = onUpdate;
  // 注册一次进度事件监听
  if (!progressUnsub) {
    progressUnsub = listenUpdateProgress();
  }
  setTimeout(() => checkForUpdate(currentVersion), STARTUP_DELAY_MS);
}

/** 获取待更新的信息（没有待更新时返回 null） */
export function getPendingUpdate(): UpdateInfo | null {
  return pendingUpdate;
}

/** 弹窗显示更新对话框（可被外部按钮重复调用） */
export function showUpdateDialog() {
  if (!pendingUpdate) return;
  showDialog(pendingUpdate);
}

async function checkForUpdate(currentVersion: string) {
  // 避免频繁检查
  const last = Number(localStorage.getItem(LAST_CHECK_KEY) || 0);
  if (Date.now() - last < CHECK_INTERVAL_MS) return;
  localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

  let info: UpdateInfo;
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!res.ok) return;
    info = await res.json();
  } catch {
    // 网络异常时静默失败，不影响正常使用
    return;
  }

  // 版本号比对
  if (compareSemver(info.version, currentVersion) <= 0) return;

  // 发现新版本，保存状态
  pendingUpdate = info;

  // 弹窗提示
  showDialog(info);

  // 通知外部添加持久按钮
  if (onUpdateCb) onUpdateCb(info);
}

/** 语义化版本比较。a > b 返回正数，a < b 返回负数，相等返回 0 */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function showDialog(info: UpdateInfo) {
  // 防止重复弹窗
  const existing = document.getElementById("update-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "update-overlay";
  overlay.className = "update-overlay" + (info.mandatory ? " mandatory" : "");

  const closeHtml = info.mandatory
    ? ""
    : '<button type="button" class="btn-secondary" id="update-later-btn">稍后提醒</button>';

  overlay.innerHTML = `
    <div class="update-dialog">
      <div class="update-icon">🎉</div>
      <h3>发现新版本 v${esc(info.version)}</h3>
      <p class="update-date">发布于 ${esc(info.releaseDate)}</p>
      <pre class="update-changelog">${esc(info.changelog)}</pre>
      <div class="update-progress hidden" id="update-progress-block">
        <div class="update-progress-bar"><div class="update-progress-fill" id="update-progress-fill"></div></div>
        <div class="update-progress-text" id="update-progress-text">准备下载...</div>
      </div>
      <div class="update-actions">
        <button type="button" class="btn-primary" id="update-download-btn">立即下载</button>
        <a href="${esc(info.downloadUrl)}" target="_blank" rel="noopener" class="btn-link" id="update-browser-btn">浏览器下载</a>
        ${closeHtml}
      </div>
    </div>
  `;

  // 遮罩层点击关闭（非强制更新时）
  if (!info.mandatory) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // "稍后提醒"按钮直接关闭
  const laterBtn = overlay.querySelector<HTMLButtonElement>("#update-later-btn");
  if (laterBtn) {
    laterBtn.addEventListener("click", () => overlay.remove());
  }

  // "立即下载"按钮：调用 Rust 后端流式下载
  const downloadBtn = overlay.querySelector<HTMLButtonElement>("#update-download-btn");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", () => startInAppDownload(info, overlay));
  }

  document.body.appendChild(overlay);
}

/**
 * 触发应用内下载：调用 Rust 后端流式下载安装包，
 * 监听 update:progress 事件更新进度条，完成后提示用户文件路径。
 */
async function startInAppDownload(info: UpdateInfo, overlay: HTMLElement) {
  const downloadBtn = overlay.querySelector<HTMLButtonElement>("#update-download-btn");
  const browserBtn = overlay.querySelector<HTMLAnchorElement>("#update-browser-btn");
  const progressBlock = overlay.querySelector<HTMLElement>("#update-progress-block");
  const progressFill = overlay.querySelector<HTMLElement>("#update-progress-fill");
  const progressText = overlay.querySelector<HTMLElement>("#update-progress-text");

  if (downloadBtn) {
    downloadBtn.disabled = true;
    downloadBtn.textContent = "下载中...";
  }
  if (browserBtn) browserBtn.classList.add("hidden");
  if (progressBlock) progressBlock.classList.remove("hidden");
  if (progressFill) progressFill.style.width = "0%";
  if (progressText) progressText.textContent = "准备下载...";

  // 从 downloadUrl 提取文件名（取 URL 最后一段）
  const filename = info.downloadUrl.split("/").pop() || `passport-ocr_${info.version}_x64_en-US.msi`;

  try {
    const savedPath = await invoke<string>("download_update", {
      url: info.downloadUrl,
      filename,
    });
    if (progressFill) progressFill.style.width = "100%";
    if (progressText) progressText.textContent = `✓ 下载完成`;
    if (downloadBtn) {
      downloadBtn.textContent = "已完成";
      downloadBtn.classList.add("btn-done");
    }
    alert(`更新包已下载到:\n${savedPath}\n\n请关闭应用后双击安装。`);
  } catch (err) {
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.textContent = "重试下载";
    }
    if (browserBtn) browserBtn.classList.remove("hidden");
    if (progressText) progressText.textContent = `✗ 下载失败: ${err}`;
    console.error("download_update failed:", err);
  }
}

/** 监听 Rust 端 emit 的下载进度事件，更新所有弹窗中的进度条 */
function listenUpdateProgress(): () => void {
  let unsub: (() => void) | null = null;
  listen<{ progress: number; downloaded: number; total: number }>(
    "update:progress",
    (event) => {
      const { progress, downloaded, total } = event.payload;
      const fill = document.getElementById("update-progress-fill");
      const text = document.getElementById("update-progress-text");
      if (fill) fill.style.width = `${progress}%`;
      if (text) {
        const dl = (downloaded / 1024 / 1024).toFixed(2);
        const tt = (total / 1024 / 1024).toFixed(2);
        text.textContent = `下载中... ${progress}% (${dl}MB / ${tt}MB)`;
      }
    }
  ).then((u) => {
    unsub = u;
  });
  return () => {
    if (unsub) unsub();
  };
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

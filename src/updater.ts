// 应用内更新检查（GitHub + jsDelivr CDN）
// 发版时更新 version.json 到 GitHub 仓库，客户端通过 jsDelivr 加速获取

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

/**
 * 初始化自动更新检查。在应用启动后调用一次即可。
 * @param currentVersion 当前版本号，如 "1.0.0"
 */
export function initAutoUpdate(currentVersion: string) {
  setTimeout(() => checkForUpdate(currentVersion), STARTUP_DELAY_MS);
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

  // 发现新版本，弹窗提示
  showUpdateDialog(info);
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

function showUpdateDialog(info: UpdateInfo) {
  // 防止重复弹窗
  const existing = document.getElementById("update-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "update-overlay";
  overlay.className = "update-overlay" + (info.mandatory ? " mandatory" : "");
  overlay.innerHTML = `
    <div class="update-dialog">
      <div class="update-icon">🎉</div>
      <h3>发现新版本 v${esc(info.version)}</h3>
      <p class="update-date">发布于 ${esc(info.releaseDate)}</p>
      <pre class="update-changelog">${esc(info.changelog)}</pre>
      <div class="update-actions">
        <a href="${esc(info.downloadUrl)}" target="_blank" rel="noopener" class="btn-primary" data-act="download">
          前往下载
        </a>
        ${info.mandatory ? "" : '<button type="button" class="btn-secondary" data-act="close">稍后提醒</button>'}
      </div>
    </div>
  `;

  // 点击关闭按钮或遮罩层（非强制更新时）关闭弹窗
  overlay.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.act === "close" || (!info.mandatory && t === overlay)) {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
}

function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}
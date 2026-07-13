# 📖 护照信息识别工具

AI 驱动的桌面端护照信息识别工具，上传护照图片、自动 OCR 识别关键字段并批量导出为 Excel。

---

## 技术栈

- **前端**：Vite + TypeScript (Vanilla)
- **桌面框架**：Tauri 2.x（仅输出 MSI 安装包）
- **后端**：Rust (reqwest + serde + rust_xlsxwriter + hmac/sha2)
- **AI API**：OpenAI Vision API（兼容任意 OpenAI 标准接口的服务）
- **更新分发**：GitHub Release + jsDelivr CDN（应用内自动检测 + 流式下载）

---

## 功能特性

- 📷 上传护照图片（支持 JPG/PNG，可多选/拖拽）
- 🤖 调用 OpenAI Vision API 自动识别护照字段（识别中可继续添加，自动纳入处理）
- ✏️ 手动校正（联系电话可编辑）
- 📥 批量导出 Excel（标准模板格式，支持自定义导出目录）
- 🖼️ 自定义背景图（设置弹窗中可上传/清除）
- 🔒 内置授权码校验（编译时注入，到期自动拦截）
- 🎉 应用内自动更新（GitHub + jsDelivr 检测新版本，应用内直接下载安装包）

---

## 快速开始

### 环境要求

| 工具 | 版本 | 备注 |
|------|------|------|
| Rust | 1.77+ | 当前 1.96.1 |
| Node.js | 18+ | 当前 24.14.0 |
| Tauri CLI | ^2 | `cargo install tauri-cli --version "^2"`，当前 2.11.4 |
| Windows | 10/11 | MSI 仅支持 Windows |

### 安装运行

```bash
# 安装前端依赖
npm install

# 开发模式（热更新）
npm run tauri dev

# 构建 MSI 安装包
npm run tauri build
```

构建产物：
- 可执行文件：`src-tauri/target/release/passport-ocr.exe`
- 安装包：`src-tauri/target/release/bundle/msi/passport-ocr_<version>_x64_en-US.msi`

### 一键发版

修改 4 个文件的版本号为上一个发过的版本号，跑：

```powershell
.\release.ps1
```

脚本自动 bump 版本号（patch +1，满 9 进 1 到 minor）、构建 MSI、上传 GitHub Release、推送 `version.json` 到 `github main` 分支。**约 5-6 分钟完成**。详见 `release.ps1` 顶部注释。

需要跳级时：`.\release.ps1 -Version 1.5.0`

---

## 项目结构

```
passport-data-retrieval/
├── index.html                  # 主页面（设置弹窗、授权遮罩、更新弹窗）
├── package.json                # 前端依赖 + 版本号
├── vite.config.ts              # Vite 配置（注入构建日期 + 版本号）
├── version.json                # 发版声明文件（客户端更新检测）
├── license.config.json         # 授权码配置（有效期/单位/签名密钥）
├── release.ps1                 # 一键发版脚本（自动 bump + 构建 + 上传 + 推送）
├── 构建.bat                     # Windows 快捷构建（开发用）
├── 启动护照工具.bat             # Windows 快捷启动
├── src/
│   ├── main.ts                 # 前端主逻辑（OCR、导出、授权校验入口）
│   ├── style.css               # 样式
│   └── updater.ts              # 应用内自动更新检查 + 下载
└── src-tauri/
    ├── Cargo.toml              # Rust 依赖 + 版本号
    ├── tauri.conf.json         # Tauri 配置 + 版本号
    ├── build.rs                # 编译时生成授权码
    ├── capabilities/default.json
    ├── icons/                  # 应用图标
    └── src/
        ├── main.rs             # 入口
        ├── lib.rs              # Tauri 命令注册
        ├── openai.rs           # OpenAI API 客户端
        ├── excel.rs            # Excel 生成
        ├── download.rs         # 安装包流式下载 + 进度事件
        └── license.rs          # 授权码解析与校验
```

---

## 配置说明

### API 配置（⚙️ 设置弹窗）

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| API Key | OpenAI API 密钥 | 必填 |
| API 地址 | API 基础 URL | `https://token.sensenova.cn/v1` |
| 模型名称 | 模型名称 | `sensenova-6.7-flash-lite` |

支持任意 OpenAI 兼容接口（OpenAI、Azure OpenAI、自建服务等）。

### 授权码配置（`license.config.json`）

| 字段 | 说明 | 示例 |
|------|------|------|
| `validityValue` | 有效期数值（支持小数） | `3` / `0.5` |
| `validityUnit` | 有效期单位 | `"months"` / `"years"` |
| `secret` | HMAC 签名密钥（至少 8 字符） | 建议替换为自定义值 |

授权码在 `build.rs` 编译时基于当天日期生成，HMAC-SHA256 签名后硬编码到二进制。运行时不联网校验，到期或签名不匹配时显示授权遮罩层。详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

### 自动更新（`version.json`）

应用启动 5 秒后通过 jsDelivr CDN 静默检测 `version.json`，发现新版本弹窗提示。点击"立即下载"后**直接在应用内流式下载** MSI（带进度条），无需打开浏览器。下载完成后弹窗告知文件路径。

```json
{
  "version": "1.2.0",
  "releaseDate": "2026-07-15",
  "changelog": "• 修复 OCR 识别异常\n• 优化导出速度",
  "downloadUrl": "https://github.com/timoduizhang0/passport-data-retrieval/releases/download/v1.2.0/passport-ocr_1.2.0_x64_en-US.msi",
  "mandatory": false
}
```

| 字段 | 说明 |
|------|------|
| `version` | 新版本号 |
| `releaseDate` | 发布日期 `YYYY-MM-DD` |
| `changelog` | 更新日志，`\n` 换行 |
| `downloadUrl` | 安装包直链（`/releases/download/...`） |
| `mandatory` | `true` 强制更新，`false` 可选更新 |

> 自动更新检测的是 GitHub 仓库 `main` 分支的 `version.json`（jsDelivr CDN 缓存约 1-2 分钟）。Gitee 是源码主仓，GitHub 只用于托管 `version.json` 和 Release 资产。

### Excel 导出字段

| 列 | 字段 | 来源 |
|----|------|------|
| A | 中文姓名 | 识别 |
| B | 性别 | 识别 |
| C | 英文姓 | 识别（大写） |
| D | 英文名 | 识别（大写） |
| E | 证件类型 | 固定"护照" |
| F | 证件号 | 识别 |
| G | 客户类型 | 固定"在职" |
| H | 国籍 | 识别 |
| I | 出生日期 | 识别 `YYYY-MM-DD` |
| J | 出生地 | 识别 |
| K | 签发地 | 识别 |
| L | 签发日期 | 识别 |
| M | 有效期 | 识别 |
| N | 国家码 | 识别（如 CHN） |
| O | 联系电话 | 手动填写 |

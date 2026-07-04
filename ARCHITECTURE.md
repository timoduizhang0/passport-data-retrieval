# 护照信息识别工具 — 技术架构文档

> 本文档描述项目的整体架构、数据流、关键设计模式和模块职责，供后续类似项目复用参考。

---

## 1. 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                     desktop-app                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │                 Frontend (Vite)                   │   │
│  │  ┌────────────┐  ┌───────────┐  ┌─────────────┐ │   │
│  │  │  index.html │  │  main.ts  │  │  style.css  │ │   │
│  │  │  (UI 布局)  │  │  (逻辑)   │  │  (样式)     │ │   │
│  │  └────────────┘  └─────┬─────┘  └─────────────┘ │   │
│  │                         │ invoke()                │   │
│  │                         ▼                         │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │         Tauri 2.x Bridge (IPC)                 │ │   │
│  │  └──────────────────────┬─────────────────────────┘ │   │
│  └─────────────────────────┼───────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────┼───────────────────────────┐   │
│  │               Rust Backend (src-tauri/src)          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │   │
│  │  │  lib.rs  │  │ openai.rs│  │   excel.rs       │  │   │
│  │  │(命令注册)│  │(API调用) │  │(Excel生成)       │  │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 核心分层

| 层 | 技术 | 职责 |
|----|------|------|
| **UI 层** | HTML + CSS | 页面布局、弹窗、缩略图、表格渲染 |
| **逻辑层** | TypeScript (Vanilla) | 状态管理、事件绑定、调用后端命令 |
| **桥接层** | Tauri 2.x IPC | 前后端通信（`invoke` / 命令） |
| **服务层** | Rust | API 调用、Excel 生成、文件处理 |

---

## 2. 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| **Tauri** | 2.x | 桌面应用框架（WebView + Rust 后端） |
| **Vite** | 6.x | 前端构建工具（HMR、TypeScript 编译） |
| **TypeScript** | Vanilla | 前端逻辑（无框架） |
| **Rust** | 2021 edition | 后端服务（API 调用、Excel 生成） |
| **reqwest** | 0.12 | Rust HTTP 客户端 |
| **serde** | 1.x | JSON 序列化/反序列化 |
| **rust_xlsxwriter** | 0.82 | Excel 文件生成 |
| **chrono** | 0.4 | 日期时间处理 |
| **base64** | 0.22 | 图片 Base64 编码 |
| **tauri-plugin-dialog** | 2.x | 系统原生对话框（目录选择） |

---

## 3. 目录结构

```
passport-ocr/
├── index.html                  # 主页面（含设置弹窗）
├── package.json                # 前端依赖（npm）
├── vite.config.ts              # Vite 配置（注入构建日期）
├── tsconfig.json               # TypeScript 配置
├── ARCHITECTURE.md             # 本文档
├── 启动护照工具.bat             # Windows 快捷启动
├── 构建.bat                     # Windows 快捷构建
├── src/
│   ├── main.ts                 # 前端所有逻辑
│   └── style.css               # 全局样式
├── src-tauri/
│   ├── Cargo.toml              # Rust 依赖
│   ├── tauri.conf.json         # Tauri 配置（窗口、构建、打包）
│   ├── build.rs                # Tauri 构建脚本
│   ├── capabilities/
│   │   └── default.json        # 权限声明（dialog 等）
│   ├── icons/                  # 应用图标
│   └── src/
│       ├── main.rs             # Rust 入口（windows_subsystem）
│       ├── lib.rs              # Tauri 命令注册 + 启动
│       ├── openai.rs           # OpenAI Vision API 客户端
│       └── excel.rs            # Excel 文件生成引擎
└── dist/                       # 构建输出
```

---

## 4. 数据流

### 4.1 完整识别流程

```
用户操作                    Frontend                         Rust Backend               External API
─────────                  ────────                         ───────────                ────────────
1. 选择图片 ──────→ fileInput.click()
                   ↓
2.              handleFileInput()
                   entries.push({file, status:"pending"})
                   renderThumbnails()
                   ↓
3. 点击开始识别 ──→ startAll()
                   while(entries.find(status:"pending")) {
                     entry.status = "recognizing"
                     renderThumbnails()
                     file.arrayBuffer() → base64 ──→ invoke("recognize_passport_base64") ──→ HTTP POST /chat/completions
                     ↓                                        ↓                                    ↓
                     entry.status = "done"  ←── Ok(data) ←── call_openai_vision()  ←── JSON response
                     renderThumbnails()
                     renderTable()
                   }
                   ↓
4.              alert("识别完成")
```

### 4.2 导出流程

```
用户操作                    Frontend                         Rust Backend
─────────                  ────────                         ───────────
1. 点击导出 ──────→ doExport()
                   检查 exportDir（localStorage）
                   未设置 → open({directory:true}) 选择目录
                   已设置 → 跳过
                   ↓
                   invoke("export_excel_batch") ──────→ generate_excel_batch()
                   {dataList, outputDir}                    生成文件名（带时间戳）
                                                            写入 Excel（含隐藏 sheet）
                   ←── Ok(filePath)                    ←── workbook.save()
                   ↓
                   alert("导出成功: 路径")
                   exportHistory.unshift()
```

---

## 5. 关键设计模式

### 5.1 Tauri 命令注册模式

**Rust 端** — 用 `#[tauri::command]` 属性声明，在 `run()` 中注册：

```rust
// lib.rs
#[tauri::command]
async fn recognize_passport_base64(
    image_base64: String,
    api_key: String,
    api_url: String,
    model: String,
) -> Result<PassportData, String> {
    // 异步逻辑
    Ok(data)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            recognize_passport,
            recognize_passport_base64,
            export_excel_batch,
        ])
        .run(tauri::generate_context!())
}
```

**前端调用**：

```typescript
import { invoke } from "@tauri-apps/api/core";
const data = await invoke<PassportData>("recognize_passport_base64", {
    imageBase64: base64,
    apiKey: config.apiKey,
    apiUrl: config.apiUrl,
    model: config.model,
});
```

> **关键点**：前端参数名必须与 Rust 函数参数名**完全一致**（snake_case 自动映射为 camelCase）。

### 5.2 事件代理（Event Delegation）

避免为动态生成的元素逐个绑定事件，使用父容器代理：

```typescript
// 删除按钮是动态生成的，用事件代理
thumbnails.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".thumb-del");
    if (!btn) return;
    const id = parseInt(btn.dataset.id!);
    deleteEntry(id);
});
```

### 5.3 localStorage 持久化

API 配置和导出目录路径均持久化到 `localStorage`：

```typescript
// 保存
localStorage.setItem("passport-ocr:export-dir", dir);

// 加载（初始化时）
let exportDir = localStorage.getItem("passport-ocr:export-dir") || "";

// 每次输入变化自动保存
CONFIG_KEYS.forEach((id) => {
    $(id).addEventListener("change", saveApiConfig);
    $(id).addEventListener("blur", saveApiConfig);
});
```

### 5.4 动态识别队列

使用 `while` 循环而非 `for` 捕获列表，确保识别过程中新上传的图片被自动纳入：

```typescript
while (true) {
    const entry = entries.find((e) => e.status === "pending");
    if (!entry) break;
    // 处理 entry
}
```

### 5.5 Vite 构建时注入

通过 `vite.config.ts` 的 `define` 选项在构建时注入编译时常量：

```typescript
// vite.config.ts
define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().split("T")[0]),
}

// main.ts 中引用
declare const __BUILD_DATE__: string;
buildDateEl.textContent = __BUILD_DATE__;
```

### 5.6 模态弹窗模式

```html
<div id="settings-modal" class="modal-overlay hidden">
    <div class="modal-content">
        <div class="modal-header">
            <h2>⚙️ 设置</h2>
            <button id="modal-close-btn" class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
            <!-- 表单内容 -->
        </div>
    </div>
</div>
```

```typescript
// 打开
settingsBtn.addEventListener("click", () => {
    settingsModal.classList.remove("hidden");
});

// 关闭（点击 × 或点击遮罩）
modalCloseBtn.addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) closeSettings();
});
```

---

## 6. 模块职责

### 6.1 前端（`src/main.ts`）

单个文件，按功能区域划分：

| 区域 | 行号范围 | 职责 |
|------|---------|------|
| 类型定义 | 5-21 | `PassportData`、`PassportEntry` 接口 |
| 状态管理 | 23-28 | `entries`、`isRecognizing`、`exportDir` |
| DOM 引用 | 30-48 | 所有 `getElementById` 引用 |
| 文件选择 | 73-100 | `selectFile()`、`handleFileInput()` |
| 渲染 | 102-155 | `renderThumbnails()`、`renderTable()`、`updateButtons()` |
| 识别逻辑 | 162-231 | `startAll()`、`updateProgress()` |
| 导出目录 | 233-254 | `selectExportDir()`、`renderExportDir()` |
| 导出逻辑 | 256-288 | `doExport()` |
| 删除逻辑 | 290-301 | `deleteEntry()` |
| 事件绑定 | 303-324 | 所有事件监听器 |
| 设置弹窗 | 326-332 | 打开/关闭弹窗 |
| 初始化 | 334-339 | 加载配置、显示版本 |

### 6.2 Rust 后端

| 文件 | 职责 | 关键函数 |
|------|------|---------|
| `main.rs` | 入口 | `main()` → 调用 `lib::run()` |
| `lib.rs` | 命令注册 + 启动 | `run()`、`recognize_passport()`、`recognize_passport_base64()`、`export_excel_batch()` |
| `openai.rs` | OpenAI API 调用 | `call_openai_vision()`、`file_to_base64()`、`extract_json()` |
| `excel.rs` | Excel 生成 | `generate_excel_batch()` |

---

## 7. 配置与构建

### 7.1 权限声明

在 `src-tauri/capabilities/default.json` 中声明：

```json
{
    "permissions": [
        "core:default",
        "dialog:default",
        "dialog:allow-open",
        "dialog:allow-save"
    ]
}
```

### 7.2 构建流程

```bash
# 1. 安装依赖
npm install

# 2. 开发模式（热更新）
npm run tauri dev

# 3. 生产构建
npm run tauri build

# 构建产物
# - src-tauri/target/release/passport-ocr.exe     （可执行文件）
# - src-tauri/target/release/bundle/msi/*.msi     （MSI 安装包）
# - src-tauri/target/release/bundle/nsis/*.exe    （NSIS 安装包）
```

### 7.3 构建时自动执行

`tauri.conf.json` 配置了构建前后的钩子：

```json
{
    "build": {
        "beforeDevCommand": "npm run dev",
        "beforeBuildCommand": "npm run build"
    }
}
```

---

## 8. 复用指南

### 8.1 如果要复用到类似项目

按以下步骤操作：

1. **复制目录结构**：保留 `src/` 和 `src-tauri/` 的骨架
2. **修改 `Cargo.toml`**：更新包名、依赖版本
3. **修改 `tauri.conf.json`**：更新 `productName`、`identifier`、窗口标题
4. **修改 `package.json`**：更新 `name`、`version`
5. **替换 `capabilities/default.json`**：按需添加/删除权限
6. **替换 `src-tauri/icons/`**：应用图标
7. **修改 `openai.rs` 的 prompt**：根据新场景调整 AI 提示词
8. **修改 `excel.rs` 的模板**：根据新字段调整 Excel 列头

### 8.2 可复用的模式清单

| 模式 | 文件 | 直接复用 |
|------|------|---------|
| Tauri 命令注册 | `lib.rs` | ✅ 只需改命令名和参数 |
| OpenAI Vision 调用 | `openai.rs` | ✅ 只需改 prompt |
| Excel 生成 | `excel.rs` | ✅ 只需改表头和数据字段 |
| 前端状态管理 | `main.ts` | ✅ 纯逻辑，无框架依赖 |
| 动态识别队列 | `main.ts:startAll()` | ✅ 适用于任何批处理场景 |
| 设置弹窗 | `index.html` + `main.ts` | ✅ 通用模态框模式 |
| 导出目录选择 | `main.ts:selectExportDir()` | ✅ 直接复用 `tauri-plugin-dialog` |
| 构建日期注入 | `vite.config.ts` | ✅ 直接复制 |

### 8.3 常见陷阱

| 陷阱 | 说明 | 解决 |
|------|------|------|
| Tauri 命令参数名 | 前端传递的 key 必须与 Rust 函数参数名一致 | 用 `snake_case` 命名 Rust 参数 |
| `dialog:allow-open` 权限 | 使用对话框必须声明权限 | 在 `capabilities/default.json` 中添加 |
| 文件读取 | 前端通过 `File.arrayBuffer()` 读取，转 base64 传给 Rust | 标准做法，无需额外权限 |
| 构建日期 | 使用 Vite `define` 注入，仅构建时有效 | 开发模式显示 `undefined`，可在 `vite.config.ts` 中加 fallback |

---

## 9. 依赖版本参考

```json
// package.json
{
    "dependencies": {
        "@tauri-apps/api": "^2.0.0",
        "@tauri-apps/plugin-dialog": "^2.0.0"
    },
    "devDependencies": {
        "@tauri-apps/cli": "^2.0.0",
        "typescript": "^5.3.0",
        "vite": "^6.0.0"
    }
}
```

```toml
# Cargo.toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
base64 = "0.22"
rust_xlsxwriter = "0.82"
chrono = "0.4"
```

---

> **文档版本**：1.0.0  
> **最后更新**：2026-07-04  
> **适用项目**：passport-data-retrieval（Tauri 2.x + Rust + Vite + Vanilla TS）
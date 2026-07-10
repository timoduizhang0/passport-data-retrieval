# 📖 护照信息识别工具

AI 驱动的桌面端护照信息识别工具，上传护照图片、自动 OCR 识别关键字段并批量导出为 Excel。

## 技术栈

- **前端**：Vite + TypeScript (Vanilla)
- **桌面框架**：Tauri 2.x
- **后端**：Rust (reqwest + serde + rust_xlsxwriter + hmac/sha2)
- **AI API**：OpenAI Vision API（兼容任意 OpenAI 标准接口的服务）
- **插件**：tauri-plugin-dialog（系统对话框）

## 功能特性

- 📷 上传护照图片（支持 JPG/PNG，可多选/拖拽）
- 🗑️ 管理图片（hover 删除已上传的照片）
- 🤖 调用 OpenAI Vision API 自动识别护照字段（识别中可继续添加，自动纳入处理）
- 📋 展示识别结果（15 个字段）
- ✏️ 手动校正（联系电话可编辑）
- 📥 批量导出 Excel（标准模板格式，支持自定义导出目录）
- 📂 导出记录追踪
- 🖼️ 自定义背景图（设置弹窗中可上传/清除）
- 🔒 内置授权码校验（编译时注入，到期自动拦截）
- 🎉 应用内自动更新提示（通过 GitHub + jsDelivr CDN 检测新版本，应用内直接下载）

## 快速开始

### 环境要求

- [Rust](https://www.rust-lang.org/) 1.77+（当前使用 1.96.1）
- [Node.js](https://nodejs.org/) 18+（当前使用 24.14.0）
- [Tauri CLI](https://v2.tauri.app/start/cli/) — `cargo install tauri-cli --version "^2"`（当前使用 2.11.4）

### 安装运行

```bash
# 安装前端依赖
cd passport-ocr
npm install

# 开发模式运行（热更新）
npm run tauri dev

# 构建可执行文件
npm run tauri build
```

构建产物位于 `src-tauri/target/release/passport-ocr.exe`，安装包位于 `src-tauri/target/release/bundle/` 下。

## 项目结构

```
passport-data-retrieval/
├── index.html                  # 主页面（含设置弹窗、授权遮罩、更新提示）
├── package.json                # 前端依赖
├── vite.config.ts              # Vite 配置（注入构建日期 + 版本号）
├── tsconfig.json               # TypeScript 配置
├── version.json                # 发版声明文件（用于客户端更新检测）
├── license.config.json         # 授权码配置（有效期/单位/签名密钥）
├── .cnb.yml                    # CNB 云原生构建流水线
├── 启动护照工具.bat             # Windows 快捷启动
├── 构建.bat                     # Windows 快捷构建
├── src/
│   ├── main.ts                 # 前端逻辑（含授权校验入口、更新检测）
│   ├── style.css               # 样式（含授权遮罩、更新弹窗样式）
│   └── updater.ts              # 应用内自动更新检查（GitHub + jsDelivr）
└── src-tauri/
    ├── Cargo.toml              # Rust 依赖
    ├── tauri.conf.json         # Tauri 配置
    ├── build.rs                # 编译时生成授权码并注入环境变量
    ├── capabilities/
    │   └── default.json        # 权限配置
    ├── icons/                  # 应用图标
    └── src/
        ├── main.rs             # 入口
        ├── lib.rs              # Tauri 命令注册（含 get_license_info、download_update）
        ├── openai.rs           # OpenAI API 客户端
        ├── excel.rs            # Excel 生成
        ├── download.rs         # 安装包下载（流式下载 + 进度通知）
        └── license.rs          # 授权码解析与校验
└── ARCHITECTURE.md             # 详细架构文档
```

## 配置说明

### API 配置（⚙️ 右下角设置弹窗）

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| API Key | OpenAI API 密钥 | 必填 |
| API 地址 | API 基础 URL | `https://token.sensenova.cn/v1` |
| 模型名称 | 模型名称 | `sensenova-6.7-flash-lite` |

支持任意 OpenAI 兼容接口（如 `https://api.openai.com/v1`、Azure OpenAI 等）。

### 授权码配置（`license.config.json`，项目根目录）

| 字段 | 说明 | 示例 |
|------|------|------|
| `validityValue` | 有效期数值（支持小数） | `3` / `0.5` |
| `validityUnit` | 有效期单位 | `"months"` / `"years"` |
| `secret` | HMAC 签名密钥（至少 8 字符） | 建议替换为自定义值 |

授权码在 `build.rs` 编译时基于当天日期生成，HMAC-SHA256 签名后硬编码到二进制中。运行时不联网校验，到期或签名不匹配时显示授权遮罩层阻止使用。详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

### 自动更新（`version.json`）

应用启动 5 秒后通过 jsDelivr CDN 静默检测 `version.json`，比对版本号后弹窗提示。用户点击"立即下载"后，**直接在应用内下载**安装包（显示进度条），无需离开应用。

#### 更新版本的详细操作

每次发版按以下顺序操作：

**1. 修改版本号**

打开 `package.json`，将 `version` 字段更新为新版本：

```json
{
  "version": "1.2.0"
}
```

**2. 更新 `version.json`**

打开项目根目录的 `version.json`，同步更新版本信息：

```json
{
  "version": "1.2.0",
  "releaseDate": "2026-07-15",
  "changelog": "• 修复 OCR 识别异常\n• 优化导出速度",
  "downloadUrl": "https://github.com/timoduizhang0/passport-data-retrieval/releases/download/v1.2.0/passport-ocr-setup.exe",
  "mandatory": false
}
```

| 字段 | 说明 |
|------|------|
| `version` | 新版本号，必须与 `package.json` 一致 |
| `releaseDate` | 发布日期，格式 `YYYY-MM-DD` |
| `changelog` | 更新日志，支持 `\n` 换行 |
| `downloadUrl` | 安装包的**直接下载链接**（必须是 `.exe`/`.msi`/`.dmg`/`.deb` 文件的直链） |
| `mandatory` | `true` 强制更新（不允许关闭），`false` 可选更新 |

**3. 推送代码到 GitHub**

```bash
git add package.json version.json
git commit -m "chore: 发布 v1.2.0"
git push origin master
```

> 注意：本地分支名为 `master`，自动更新检测读取的是 GitHub 仓库的内容。

**4. 构建并上传安装包**

```bash
npm run tauri build
```

将构建产物 `src-tauri/target/release/bundle/` 下的安装包上传到 GitHub Release 页面，并确保 `version.json` 中的 `downloadUrl` 指向该文件的**直接下载链接**（形如 `https://github.com/<user>/<repo>/releases/download/v1.2.0/<filename>`）。

**5. 验证更新检测**

在浏览器访问以下地址，确认返回正确的 JSON：

```
https://cdn.jsdelivr.net/gh/timoduizhang0/passport-data-retrieval@main/version.json
```

> 首次推送后需要等 1-2 分钟，jsDelivr CDN 才会同步 GitHub 内容。

#### 发版流程图

```
修改 package.json 的 version
       ↓
修改 version.json（版本 + changelog + 安装包下载链接）
       ↓
git commit + push
       ↓
npm run tauri build → 出安装包
       ↓
上传安装包到 GitHub Release
       ↓
用户启动应用 → 5 秒后自动检测 → 弹窗提示 → 应用内直接下载 → 安装
```

### Excel 导出字段

| 列 | 字段 | 说明 |
|----|------|------|
| A | 中文姓名 | 从护照识别 |
| B | 性别 | 男/女 |
| C | 英文姓 | 大写字母 |
| D | 英文名 | 大写字母 |
| E | 证件类型 | 固定为"护照" |
| F | 证件号 | 护照号码 |
| G | 客户类型 | 固定为"在职" |
| H | 国籍 | 从护照识别 |
| I | 出生日期 | YYYY-MM-DD |
| J | 出生地 | 省市 |
| K | 签发地 | 省市 |
| L | 签发日期 | YYYY-MM-DD |
| M | 有效期 | YYYY-MM-DD |
| N | 国家码 | 如 CHN |
| O | 联系电话 | 手动填写 |

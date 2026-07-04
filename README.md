# 📖 护照信息识别工具

AI 驱动的护照信息识别工具，使用标准 OpenAI 兼容 API 识别护照图片，自动填充 Excel 模板并导出。

## 技术栈

- **前端**: Vite + TypeScript (Vanilla)
- **桌面框架**: Tauri 2.x
- **后端**: Rust (reqwest, serde, rust_xlsxwriter)
- **AI API**: OpenAI Vision API (标准接口，兼容任意 OpenAI 兼容服务)

## 功能特性

- 📷 上传护照图片（支持 JPG/PNG）
- 🤖 调用 OpenAI Vision API 自动识别护照字段
- 📋 展示识别结果（15 个字段）
- ✏️ 手动校正（联系电话可编辑）
- 📥 导出为 Excel（与标准模板格式一致）
- 📂 导出记录追踪

## 快速开始

### 环境要求

- [Rust](https://www.rust-lang.org/) (1.70+)
- [Node.js](https://nodejs.org/) (18+)
- [Tauri CLI](https://v2.tauri.app/start/cli/) (`cargo install tauri-cli --version "^2"`)

### 安装运行

```bash
# 1. 安装前端依赖
cd passport-ocr
npm install

# 2. 开发模式运行（热更新）
npm run tauri dev

# 3. 构建可执行文件
npm run tauri build
```

构建完成后，可执行文件位于 `src-tauri/target/release/passport-ocr.exe`

### 使用说明

1. 启动应用后，先在 **API 配置** 区域填入你的 OpenAI API Key 和 API 地址
   - 默认使用 `https://api.openai.com/v1` 和 `gpt-4o` 模型
   - 可替换为任意 OpenAI 兼容接口（如 Azure OpenAI、本地部署等）
2. 点击 **选择图片** 上传护照照片
3. AI 自动识别并显示结果字段
4. 核对信息，填写联系电话
5. 点击 **导出 Excel** 生成文件

## 项目结构

```
passport-ocr/
├── index.html              # 主页面
├── package.json            # 前端依赖
├── vite.config.ts          # Vite 配置
├── tsconfig.json           # TypeScript 配置
├── src/
│   ├── main.ts             # 前端逻辑
│   └── style.css           # 样式
├── src-tauri/
│   ├── Cargo.toml          # Rust 依赖
│   ├── tauri.conf.json     # Tauri 配置
│   ├── capabilities/
│   │   └── default.json    # 权限配置
│   ├── icons/              # 应用图标
│   └── src/
│       ├── main.rs         # 入口
│       ├── lib.rs          # Tauri 命令注册
│       ├── openai.rs       # OpenAI API 客户端
│       └── excel.rs        # Excel 生成
└── dist/                   # 构建输出
```

## 配置说明

### API 配置

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| API Key | OpenAI API 密钥 | 必填 |
| API 地址 | API 基础 URL | `https://api.openai.com/v1` |
| 模型名称 | 模型名称 | `gpt-4o` |

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
| H | 国籍 | 固定为"中国大陆" |
| I | 出生日期 | YYYY-MM-DD |
| J | 出生地 | 省市 |
| K | 签发地 | 省市 |
| L | 签发日期 | YYYY-MM-DD |
| M | 有效期 | YYYY-MM-DD |
| N | 国家码 | 如 CHN |
| O | 联系电话 | 手动填写 |
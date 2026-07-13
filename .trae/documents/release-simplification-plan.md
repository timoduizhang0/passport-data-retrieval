# 简化本地发版流程计划

## 1. Summary（目标）

把当前"改 4 个版本号 + 改 version.json + 手动 git push + 手动上传 GitHub Release"的多步手动流程，压缩为**一次交互**：

```
输入: v1.2.0
产出: MSI 装到 GitHub Release + version.json 推到 GitHub
```

手动修改点从 7 处降到 0 处，全部通过脚本完成。

## 2. Current State Analysis

### 当前手动发版流程（痛点）

| # | 手动操作 | 涉及文件 | 容易出错 |
|---|---|---|---|
| 1 | 改 `package.json` 的 `version` | `package.json` | 易遗漏 |
| 2 | 改 `src-tauri/tauri.conf.json` 的 `version` | `tauri.conf.json` | 易遗漏 |
| 3 | 改 `src-tauri/Cargo.toml` 的 `version` | `Cargo.toml` | 易遗漏 |
| 4 | 改 `version.json` 的 `version` 和 `downloadUrl`（含手写 GitHub 直链） | `version.json` | URL 易写错 |
| 5 | `npm run tauri build` 构建 MSI | — | 等待时间长 |
| 6 | 手动到 GitHub 网页上传 `.msi` 到 Release | — | 易忘记打 tag |
| 7 | 手动 `git add package.json tauri.conf.json Cargo.toml version.json && git commit && git push` | — | 仓库状态混乱 |

每次发版有 **4 处文本修改 + 1 次网页操作 + 1 次 git push**。

### 关键文件版本一致性检查

当前 [package.json](file:///d:/code/13.ai/passport-data-retrieval/package.json) `version: "1.0.1"` ✓
当前 [src-tauri/tauri.conf.json](file:///d:/code/13.ai/passport-data-retrieval/src-tauri/tauri.conf.json) `version: "1.0.1"` ✓
当前 [src-tauri/Cargo.toml](file:///d:/code/13.ai/passport-data-retrieval/src-tauri/Cargo.toml) `version = "1.0.1"` ✓
当前 [version.json](file:///d:/code/13.ai/passport-data-retrieval/version.json) `version: "1.0.1"` ✓

四处已经同步，状态干净，可以作为脚本的基线。

### 可重用的资产

- [构建.bat](file:///d:/code/13.ai/passport-data-retrieval/构建.bat) 已经把"前端 build + Rust build"串起来了，但只构建 `cargo build --release`，**不会出 MSI**（MSI 需要 `tauri build`）
- GitHub Release 上传已有 GitHub PAT 可用（用户在之前的对话中已用过 `git push` 到 `github.com/timoduizhang0/passport-data-retrieval`）
- 仓库已经配置了 git 远程（`origin` → Gitee 源码主仓，`github` → GitHub 仅用于托管 `version.json`）和 `master` 分支（本地）；GitHub 端 jsDelivr 读取的分支是 `main`

## 3. Proposed Changes

### 3.1 新增 `release.ps1` 脚本（核心）

**位置**: `d:/code/13.ai/passport-data-retrieval/release.ps1`

**职责**（替代 7 步手动操作）：

1. 接收一个参数：`-Version "1.2.0"`（不带 `v` 前缀）
2. **校验输入**：
   - 必须符合 `X.Y.Z` 格式（regex `^\d+\.\d+\.\d+$`）
   - 三个文件版本号必须能解析
3. **批量更新版本号**（用正则替换，避免误改）：
   - `package.json`: `"version": "X.Y.Z"`
   - `src-tauri/tauri.conf.json`: `"version": "X.Y.Z"`
   - `src-tauri/Cargo.toml`: `^version = "X.Y.Z"`
4. **读取本地 changelog**（可选）：
   - 提示用户在终端粘贴多行 `changelog`（结束输入空行）
   - 如跳过则写 `• 版本 X.Y.Z 发布`
   - `releaseDate` 字段由脚本自动取当前日期（`Get-Date -Format "yyyy-MM-dd"`），无需用户输入
5. **计算 downloadUrl**（关键简化点）：
   - 实际生成的 MSI 文件名是 `passport-ocr_<version>_x64_en-US.msi`
   - 验证该文件存在于 `src-tauri/target/release/bundle/msi/`
   - 自动拼出：`https://github.com/timoduizhang0/passport-data-retrieval/releases/download/v<version>/<filename>`
6. **写入 version.json**（带格式化 JSON 缩进）
7. **同步 Cargo.lock**：`cargo update -p passport-ocr`（让 Cargo.lock 里的版本号跟着 Cargo.toml 一起变，否则后续构建会报警告）
8. **运行 `npm run tauri build`**（这步最耗时，3-5 分钟）
9. **验证产物**：确认 `passport-ocr_<version>_x64_en-US.msi` 存在
10. **使用 GitHub API 上传**：
    - **自动创建 tag** `v<version>`（如果已存在则跳过）
    - `POST /repos/timoduizhang0/passport-data-retrieval/releases`（如果 Release 不存在）
    - `POST https://uploads.github.com/repos/timoduizhang0/passport-data-retrieval/releases/<id>/assets?name=<filename>`（上传 .msi 文件）
11. **提交 4 个版本文件到 GitHub**：
    - `git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock version.json`
    - `git commit -m "chore: 发布 v<version>"`
    - `git push github master:main`（**注意**：本地分支是 `master`，推到 GitHub 远端的 `main` 分支，jsDelivr 才能读到）
    - 源码主仓 `origin` (Gitee) 的同步**不在本脚本范围内**，由开发流程决定是否单独 push
12. **打印最终摘要**：
    - GitHub Release URL
    - version.json 实际内容
    - jsDelivr CDN 验证链接（`https://cdn.jsdelivr.net/gh/timoduizhang0/passport-data-retrieval@main/version.json`）

### 3.2 GitHub Token 管理

**前置条件（一次性，文档化在 README）**：

1. 用户访问 https://github.com/settings/tokens 生成 PAT
2. 勾选权限：`repo`（完整仓库访问）
3. 在 PowerShell 持久化：
   ```powershell
   [System.Environment]::SetEnvironmentVariable("GITHUB_TOKEN", "ghp_xxxx", "User")
   ```
4. 重启终端生效

脚本从 `$env:GITHUB_TOKEN` 读取，**避免硬编码在文件里**。

### 3.3 PowerShell 执行策略

Windows 默认禁止运行 `.ps1` 脚本，首次运行 `release.ps1` 会报：

```
.\release.ps1 : File C:\...\release.ps1 cannot be loaded because running scripts is disabled on this system.
```

**一次性解决方案**（以当前用户为作用域，不影响其他用户）：

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

执行后输入 `Y` 确认即可。之后本机任何位置运行 `.ps1` 都顺畅。

### 3.4 用户体验流程

**改版前**：用户改 4 个文件 + 1 个网页 + 1 个 git push，约 8 分钟

**改版后**：
```powershell
.\release.ps1 -Version 1.2.0
```
按提示粘贴 changelog → 等待构建完成 → 自动上传 + git push，**约 5-6 分钟**（主要是 tauri build 占 3-5 分钟），且零手动修改。

### 3.5 错误处理策略（最小化）

按 AGENTS.md 第 2 条"简洁优先"——不为不可能发生的场景写容错：

- **构建失败**：脚本自动执行 `git checkout -- package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock version.json` 还原工作区，并打印 Cargo 错误最后 20 行
- **GitHub API 失败**：打印响应码和 body，由用户手动重试（版本号改动已在本地，无需回滚）
- **版本号格式错误**：拒绝继续
- **不处理**：网络中断中途恢复、Token 过期等异常（一次性手动重跑即可）

### 3.6 不在本计划范围内

- ❌ CNB 流水线（用户明确说"不涉及 cnb 平台"）
- ❌ MSI 自动签名（用户没要求）
- ❌ 跨平台构建（用户只关心 Windows）
- ❌ 自动 bump minor/patch 版本（用户说"手动修改越少越好"但没说"全自动"，先让用户显式传版本号，更可控）

## 4. Assumptions & Decisions

| 假设 | 理由 |
|---|---|
| 用户当前在 master 分支，git 状态干净 | release.ps1 会在脚本开头 `git status --porcelain` 校验 |
| GitHub PAT 已生成并设到 `GITHUB_TOKEN` 环境变量 | 这是行业标准做法，文档会说明 |
| GitHub 仓库的 `tag` 命名约定是 `vX.Y.Z` | 与现状一致（之前是 `v1.0.1`） |
| 单平台只打 MSI（不交叉编译 macOS/Linux） | 之前已经强制 `targets: ["msi"]` |
| changelog 直接从终端读 stdin 多行输入 | 简单直接，避免引外部文件或交互式编辑器 |
| MSI 文件名格式 Tauri 自动生成的就是 `passport-ocr_<version>_x64_en-US.msi` | 已验证（之前 [build 产物](file:///d:/code/13.ai/passport-data-retrieval/src-tauri/target/release/bundle/msi/)） |
| **源码主仓在 Gitee（`origin` 远程），GitHub（`github` 远程）只用于托管 `version.json`** | 用户明确说明：GitHub 核心目的就是更新功能 |
| **本地分支 `master` 需要 push 到 GitHub 远端的 `main` 分支** | jsDelivr URL 写死 `@main`，GitHub 默认分支也是 `main` |

## 5. Verification Steps

执行以下检查清单确认计划正确：

1. **静态检查**：在 `master` 分支跑一次 `git status` 确认没有未提交改动
2. **脚本空跑**：`.\release.ps1 -Version 1.0.1` 跳过 changelog 直接回车，应能完成"改版本号 + 重新构建 + 重新生成 version.json"全过程（即使 GitHub 上传失败也应给出明确错误）
3. **端到端测试**（用新版本如 `1.0.2`）：
   - 运行 `.\release.ps1 -Version 1.0.2`
   - 输入变更日志
   - 等待构建完成
   - 确认 GitHub Release 页面能看到 `v1.0.2` tag 和 .msi 资产
   - 确认 GitHub 仓库 `main` 分支的 `version.json` 已更新
   - **用脚本发布的 MSI 重新安装应用**（否则本地版本仍是旧版，不会弹更新提示）
   - 启动应用，5 秒后应弹出 v1.0.2 更新提示
4. **回归测试**：完成发版后，GitHub `main` 分支应该有**一个 commit** 包含 5 个文件（package.json / tauri.conf.json / Cargo.toml / Cargo.lock / version.json），**不污染其他文件**
5. **更新 README.md** 的"如何更新版本"章节，反映新的单脚本流程

## 6. File Touch List

| 文件 | 类型 | 改动 |
|---|---|---|
| `d:/code/13.ai/passport-data-retrieval/release.ps1` | 新增 | 主发版脚本（~150 行） |
| `d:/code/13.ai/passport-data-retrieval/README.md` | 修改 | 更新"如何更新版本"章节，改为单命令流程；增加 PowerShell 执行策略说明 |
| `d:/code/13.ai/passport-data-retrieval/构建.bat` | 不动 | 给开发用，不动 |
| `d:/code/13.ai/passport-data-retrieval/src-tauri/Cargo.lock` | 脚本自动更新 | 跟随 Cargo.toml 改版本号 |

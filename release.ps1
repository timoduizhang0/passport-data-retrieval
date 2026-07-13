# 简化本地发版流程脚本
# 用法: .\release.ps1               （自动从 package.json 读取版本号，按规则 bump）
#       .\release.ps1 -Version 1.2.0 （手动指定版本号，可选）
# 自动 bump 规则：patch +1；patch 满 9 进 1 到 minor
#       1.0.1 -> 1.0.2, 1.0.8 -> 1.0.9, 1.0.9 -> 1.1.0, 1.5.9 -> 1.6.0
# 前置: 当前分支 master 工作区干净；环境变量 $env:GITHUB_TOKEN 已设置

[CmdletBinding()]
param(
    [string]$Version
)

# 切换到脚本所在目录（保证路径相对脚本位置正确）
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

# 颜色输出辅助
function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "[ERR] $msg" -ForegroundColor Red; exit 1 }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }

# === 步骤 0：前置校验 ===
Write-Step "步骤 0/12：前置校验"

# 如果没传 -Version，从 package.json 读取当前版本号，按规则 bump
# 规则：patch +1；如果 patch > 9，则 patch 归零、minor +1（patch 满 9 进 1）
#       1.0.1 -> 1.0.2, 1.0.8 -> 1.0.9, 1.0.9 -> 1.1.0, 1.5.9 -> 1.6.0
if ([string]::IsNullOrEmpty($Version)) {
    $pkgContent = Get-Content "package.json" -Raw -Encoding UTF8
    if ($pkgContent -notmatch '"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"') {
        Write-Err "无法从 package.json 读取当前版本号"
    }
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    $patch = [int]$Matches[3]
    $currentVer = "$major.$minor.$patch"

    $patch += 1
    if ($patch -gt 9) {
        $patch = 0
        $minor += 1
    }
    $Version = "$major.$minor.$patch"
    Write-Ok "自动 bump 版本号: $currentVer -> $Version"
}

# 校验版本号格式
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Err "版本号格式错误，应为 X.Y.Z（如 1.2.0），实际: $Version"
}
Write-Ok "目标版本号: $Version"

# GITHUB_TOKEN：脚本内嵌默认值（仅本机使用）
if ([string]::IsNullOrEmpty($env:GITHUB_TOKEN)) {
    $env:GITHUB_TOKEN = "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"
    Write-Warn "环境变量 GITHUB_TOKEN 未设置，使用脚本内嵌默认值"
}
Write-Ok "GITHUB_TOKEN 已就绪（长度: $($env:GITHUB_TOKEN.Length)）"

# 校验当前在 master 分支
$currentBranch = git rev-parse --abbrev-ref HEAD
if ($currentBranch -ne "master") {
    Write-Err "当前分支是 $currentBranch，必须在 master 分支上发版"
}
Write-Ok "当前分支: master"

# 校验工作区干净
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-Err "工作区有未提交改动，请先 commit 或 stash:`n$gitStatus"
}
Write-Ok "工作区干净"

# 校验必要文件存在
$requiredFiles = @(
    "package.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "version.json"
)
foreach ($f in $requiredFiles) {
    if (-not (Test-Path $f)) {
        Write-Err "找不到必要文件: $f"
    }
}
Write-Ok "必要文件齐全"

# 远程和常量
$RepoOwner = "timoduizhang0"
$RepoName  = "passport-data-retrieval"
$Remote    = "github"
$ApiBase   = "https://api.github.com"
$UploadsBase = "https://uploads.github.com"
$TagName   = "v$Version"
$MsiName   = "passport-ocr_${Version}_x64_en-US.msi"
$MsiRelPath = "src-tauri/target/release/bundle/msi/$MsiName"
$DownloadUrl = "https://github.com/$RepoOwner/$RepoName/releases/download/$TagName/$MsiName"
$JsdelivrUrl = "https://cdn.jsdelivr.net/gh/$RepoOwner/$RepoName@main/version.json"

# 修改的文件列表（用于回滚和 commit）
$TouchedFiles = @(
    "package.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "version.json"
)

# === 步骤 1：批量更新版本号 ===
Write-Step "步骤 1/12：批量更新 3 个文件的 version 字段"

$patterns = @{
    "package.json"              = '("version"\s*:\s*)"[^"]+"'
    "src-tauri/tauri.conf.json" = '("version"\s*:\s*)"[^"]+"'
    "src-tauri/Cargo.toml"      = '(?m)(^version\s*=\s*)"[^"]+"'
}

foreach ($file in $patterns.Keys) {
    $content = Get-Content $file -Raw -Encoding UTF8
    $pattern = $patterns[$file]
    $newContent = [regex]::Replace($content, $pattern, "`$1`"$Version`"", 1)
    if ($content -eq $newContent) {
        Write-Err "文件 $file 版本号替换失败（正则未匹配）"
    }
    # 用 UTF-8 无 BOM 写出（保持和 git 提交时一致）
    $utf8NoBom = New-Object System.Text.UTF8Encoding $False
    [System.IO.File]::WriteAllText((Resolve-Path $file).Path, $newContent, $utf8NoBom)
    Write-Ok "已更新 $file"
}

# === 步骤 2：读取 changelog 和当前日期 ===
Write-Step "步骤 2/12：输入 changelog（直接回车跳过，空行结束）"
$changelogLines = @()
while ($true) {
    $line = Read-Host
    if ([string]::IsNullOrWhiteSpace($line)) { break }
    $changelogLines += $line
}
if ($changelogLines.Count -eq 0) {
    $changelog = "• 版本 $Version 发布"
} else {
    $changelog = ($changelogLines | ForEach-Object { "• $_" }) -join "`n"
}
$releaseDate = Get-Date -Format "yyyy-MM-dd"
Write-Ok "releaseDate: $releaseDate"
Write-Ok "changelog: $changelog"

# === 步骤 3：写入 version.json ===
Write-Step "步骤 3/12：写入 version.json"
$versionObj = [ordered]@{
    version     = $Version
    releaseDate = $releaseDate
    changelog   = $changelog
    downloadUrl = $DownloadUrl
    mandatory   = $false
}
$versionJson = $versionObj | ConvertTo-Json -Depth 4
$utf8NoBom = New-Object System.Text.UTF8Encoding $False
[System.IO.File]::WriteAllText((Resolve-Path "version.json").Path, $versionJson, $utf8NoBom)
Write-Ok "已写入 version.json"
Write-Host $versionJson -ForegroundColor DarkGray

# === 步骤 4：同步 Cargo.lock ===
Write-Step "步骤 4/12：同步 Cargo.lock"
cargo update -p passport-ocr 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    # 回滚
    git checkout -- $TouchedFiles
    Write-Err "cargo update 失败，已回滚工作区"
}
Write-Ok "Cargo.lock 已同步"

# === 步骤 5：执行 tauri build ===
Write-Step "步骤 5/12：执行 npm run tauri build（3-5 分钟）"
$buildOutput = npm run tauri build 2>&1 | Tee-Object -Variable buildOut
$buildExit = $LASTEXITCODE
if ($buildExit -ne 0) {
    # 回滚
    git checkout -- $TouchedFiles
    Write-Warn "tauri build 失败，已回滚工作区"
    Write-Host "`n最后 20 行错误:" -ForegroundColor Red
    $buildOut | Select-Object -Last 20 | ForEach-Object { Write-Host $_ -ForegroundColor Red }
    exit 1
}
Write-Ok "tauri build 成功"

# === 步骤 6：验证 MSI 产物 ===
Write-Step "步骤 6/12：验证 MSI 产物"
if (-not (Test-Path $MsiRelPath)) {
    Write-Err "构建产物不存在: $MsiRelPath"
}
Write-Ok "MSI 已生成: $MsiRelPath"

# === 步骤 7-8：GitHub API 创建 tag 和 Release ===
Write-Step "步骤 7/12：检查/创建 GitHub tag $TagName"
$tagUrl = "$ApiBase/repos/$RepoOwner/$RepoName/git/refs/tags/$TagName"
$tagCheck = Invoke-RestMethod -Uri $tagUrl -Headers @{ Authorization = "token $env:GITHUB_TOKEN" } -ErrorAction SilentlyContinue
if ($tagCheck -and $tagCheck.ref) {
    Write-Ok "tag $TagName 已存在，跳过创建"
    $existingTagRef = $tagCheck.object.sha
} else {
    # 拿 main 分支最新 commit 作为 tag 起点
    $mainRef = Invoke-RestMethod -Uri "$ApiBase/repos/$RepoOwner/$RepoName/git/refs/heads/main" -Headers @{ Authorization = "token $env:GITHUB_TOKEN" }
    $mainSha = $mainRef.object.sha
    # 创建 annotated tag
    $tagBody = @{
        tag     = $TagName
        message = "Release $TagName"
        object  = $mainSha
        type    = "commit"
    } | ConvertTo-Json
    try {
        $newTag = Invoke-RestMethod -Uri "$ApiBase/repos/$RepoOwner/$RepoName/git/tags" -Method Post -Headers @{ Authorization = "token $env:GITHUB_TOKEN" } -Body $tagBody -ContentType "application/json"
        $tagSha = $newTag.sha
        # 创建 ref
        $refBody = @{ ref = "refs/tags/$TagName"; sha = $tagSha } | ConvertTo-Json
        Invoke-RestMethod -Uri "$ApiBase/repos/$RepoOwner/$RepoName/git/refs" -Method Post -Headers @{ Authorization = "token $env:GITHUB_TOKEN" } -Body $refBody -ContentType "application/json" | Out-Null
        Write-Ok "tag $TagName 创建成功"
    } catch {
        Write-Err "创建 tag 失败: $_"
    }
}

Write-Step "步骤 8/12：检查/创建 GitHub Release"
$releaseUrl = "$ApiBase/repos/$RepoOwner/$RepoName/releases/tags/$TagName"
$existingRelease = Invoke-RestMethod -Uri $releaseUrl -Headers @{ Authorization = "token $env:GITHUB_TOKEN" } -ErrorAction SilentlyContinue
if ($existingRelease -and $existingRelease.id) {
    $releaseId = $existingRelease.id
    Write-Ok "Release $TagName 已存在（id=$releaseId）"
} else {
    $releaseBody = @{
        tag_name         = $TagName
        name             = "Release $Version"
        body             = $changelog
        draft            = $false
        prerelease       = $false
        target_commitish = "main"
    } | ConvertTo-Json
    try {
        $newRelease = Invoke-RestMethod -Uri "$ApiBase/repos/$RepoOwner/$RepoName/releases" -Method Post -Headers @{ Authorization = "token $env:GITHUB_TOKEN" } -Body $releaseBody -ContentType "application/json"
        $releaseId = $newRelease.id
        Write-Ok "Release 创建成功（id=$releaseId）"
    } catch {
        Write-Err "创建 Release 失败: $_"
    }
}

Write-Step "步骤 9/12：上传 MSI 到 Release"
# 检查是否已存在同名资产
$assetsUrl = "$ApiBase/repos/$RepoOwner/$RepoName/releases/$releaseId/assets"
$existingAssets = Invoke-RestMethod -Uri $assetsUrl -Headers @{ Authorization = "token $env:GITHUB_TOKEN" }
$existingAsset = $existingAssets | Where-Object { $_.name -eq $MsiName }
if ($existingAsset) {
    # 删除旧资产后重新上传
    Invoke-RestMethod -Uri "$ApiBase/repos/$RepoOwner/$RepoName/releases/assets/$($existingAsset.id)" -Method Delete -Headers @{ Authorization = "token $env:GITHUB_TOKEN" } | Out-Null
    Write-Warn "已删除同名旧资产，重新上传"
}
$uploadHeaders = @{
    Authorization = "token $env:GITHUB_TOKEN"
    "Content-Type" = "application/octet-stream"
}
try {
    Invoke-RestMethod -Uri "$UploadsBase/repos/$RepoOwner/$RepoName/releases/$releaseId/assets?name=$MsiName" -Method Post -InFile $MsiRelPath -Headers $uploadHeaders | Out-Null
    Write-Ok "MSI 上传成功"
} catch {
    Write-Err "上传 MSI 失败: $_"
}

# === 步骤 10：提交并推送到 GitHub ===
Write-Step "步骤 10/12：提交 5 个文件并推送到 github master:main"
git add $TouchedFiles
$commitMsg = "chore: 发布 $TagName"
git commit -m $commitMsg
$commitSha = git rev-parse HEAD
Write-Ok "commit: $commitSha"
git push $Remote master:main
if ($LASTEXITCODE -ne 0) {
    Write-Err "git push github master:main 失败"
}
Write-Ok "推送成功"

# === 步骤 11：验证 jsDelivr 缓存 ===
Write-Step "步骤 11/12：等待 jsDelivr CDN 同步"
Write-Host "首次推送可能需 1-2 分钟 jsDelivr 才会同步..." -ForegroundColor Yellow
$maxWait = 180
$elapsed = 0
$interval = 15
$cdReady = $false
while ($elapsed -lt $maxWait) {
    Start-Sleep -Seconds $interval
    $elapsed += $interval
    try {
        $cdnContent = Invoke-RestMethod -Uri $JsdelivrUrl -Headers @{ "Cache-Control" = "no-cache" } -ErrorAction Stop
        if ($cdnContent.version -eq $Version) {
            $cdReady = $true
            Write-Ok "jsDelivr 已同步 v$Version（等待 ${elapsed}s）"
            break
        }
    } catch {}
    Write-Host "  等待 jsDelivr... ${elapsed}s" -ForegroundColor DarkGray
}
if (-not $cdReady) {
    Write-Warn "jsDelivr 在 ${maxWait}s 内未同步到 v$Version，请稍后手动验证"
}

# === 步骤 12：打印最终摘要 ===
Write-Step "步骤 12/12：发版完成"
$summary = @{
    "Release URL"    = "https://github.com/$RepoOwner/$RepoName/releases/tag/$TagName"
    "MSI 直链"       = $DownloadUrl
    "jsDelivr 验证"  = $JsdelivrUrl
    "Commit SHA"     = $commitSha
    "version.json"   = $versionJson
}
$summary | Format-Table -AutoSize | Out-String | Write-Host

Write-Ok "全部完成！客户端启动后 5 秒会收到更新提示。"

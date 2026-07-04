@echo off
chcp 65001 >nul
echo === 护照信息识别工具 - 构建脚本 ===
echo.

echo [1/2] 构建前端...
cd /d "%~dp0"
call npm run build
if %errorlevel% neq 0 ( echo 前端构建失败! & pause & exit /b 1 )
echo 前端构建成功

echo.
echo [2/2] 构建后端...
cd /d "%~dp0src-tauri"
cargo build --release
if %errorlevel% neq 0 ( echo 后端构建失败! & pause & exit /b 1 )

echo.
echo ========================================
echo 构建成功！
echo 可执行文件: %~dp0src-tauri\target\release\passport-ocr.exe
echo.
echo 使用 启动护照工具.bat 运行
echo ========================================
pause
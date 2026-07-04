@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" "%~dp0src-tauri\target\release\passport-ocr.exe"
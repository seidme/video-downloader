@echo off
title Codeeve Video Downloader
cd /d "%~dp0"
set PATH=%~dp0bin;%PATH%

echo ==========================================
echo Starting Codeeve Video Downloader locally...
echo Interface: http://127.0.0.1:3000
echo ==========================================

:: Launch browser after 2 seconds
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:3000"

:: Run node server
if exist "%~dp0bin\node.exe" (
  "%~dp0bin\node.exe" server.js
) else (
  node server.js
)

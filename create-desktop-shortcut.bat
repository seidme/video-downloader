@echo off
setlocal
cd /d "%~dp0"

echo ====================================================
echo Creating Video Downloader Desktop Shortcut...
echo ====================================================

powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$shortcutPath = [System.IO.Path]::Combine($desktop, 'Codeeve Video Downloader.lnk'); " ^
  "$s = $ws.CreateShortcut($shortcutPath); " ^
  "$s.TargetPath = [System.IO.Path]::Combine('%~dp0', 'VideoDownloader.bat'); " ^
  "$s.WorkingDirectory = '%~dp0'; " ^
  "$ico = [System.IO.Path]::Combine('%~dp0', 'public\favicon.ico'); " ^
  "if (Test-Path $ico) { $s.IconLocation = $ico } " ^
  "$s.Description = 'Codeeve Video Downloader - 1-Click Local Media Engine'; " ^
  "$s.Save(); " ^
  "Write-Host 'Shortcut successfully created on Desktop!'"

echo.
echo Shortcut created on your Desktop: "Codeeve Video Downloader"
echo Double-click it anytime to start the app!
echo.
pause

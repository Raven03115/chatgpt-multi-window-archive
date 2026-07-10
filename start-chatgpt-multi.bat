@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js and npm were not found.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing required files for the first launch...
  call npm.cmd install
  if errorlevel 1 goto :error
)

call npm.cmd start
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo ChatGPT Multi Pane failed to start.
echo Review the error message above.
pause
exit /b 1

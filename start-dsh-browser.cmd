@echo off
rem DeepSeek Harness Browser launcher
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [dsh-browser] Node.js not found. Install Node.js 18+ from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [dsh-browser] First run: installing Electron (about 100MB, one time only)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [dsh-browser] Dependency install failed. Check network and retry.
    pause
    exit /b 1
  )
)

node_modules\.bin\electron.cmd .

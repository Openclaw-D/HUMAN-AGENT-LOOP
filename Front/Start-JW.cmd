@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 LTS, then double-click this file again.
  echo No npm install is needed to view the bundled frontend.
  pause
  exit /b 1
)
node "%~dp0start-preview.mjs"
if errorlevel 1 pause

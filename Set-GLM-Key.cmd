@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo == JW 接入真实 GLM-5.2 ==
echo 只需两步:粘贴 API Key,回车。其余自动完成。
echo.
node "Back\B\scripts\setup-glm-key.mjs"
echo.
pause

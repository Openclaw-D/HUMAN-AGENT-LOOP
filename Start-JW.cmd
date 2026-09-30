@echo off
rem JW 一键启动（双击或命令行均可；参数透传给 Start-JW.ps1）
rem 示例：Start-JW.cmd            启动 v05 栈并打开浏览器
rem       Start-JW.cmd -Status    查看状态
rem       Start-JW.cmd -Stop      停止（保留数据）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-JW.ps1" %*

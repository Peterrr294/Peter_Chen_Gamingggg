@echo off
set "PATH=%~dp0.tools\node-v24.19.0-win-x64;%PATH%"
call "%~dp0.tools\node-v24.19.0-win-x64\npm.cmd" run build

@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :error
)

echo Building watcher...
call npm run build
if errorlevel 1 goto :error

echo Starting watcher...
node dist\index.js
goto :eof

:error
echo.
echo Startup failed. Review the error above.
pause
exit /b 1

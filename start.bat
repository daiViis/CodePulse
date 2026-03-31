@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 goto :error
)

echo Starting CodePulse...
call npm run dev
goto :eof

:error
echo.
echo Startup failed. Review the error above.
pause
exit /b 1

@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" scripts\start_preview.py %*
) else (
  python scripts\start_preview.py %*
)
if errorlevel 1 (
  echo.
  echo Preview did not start. See the message above and docs/trial-guide.md.
  pause
  exit /b 1
)

@echo off
setlocal
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python 3.8 or newer and enable Add Python to PATH.
  pause
  exit /b 1
)
echo Starting Care Catalyst local server...
echo Open http://127.0.0.1:8000 in your browser.
echo Use fictional demo data only. Press Ctrl+C to stop.
python backend\server.py
pause

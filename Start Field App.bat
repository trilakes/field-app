@echo off
echo.
echo ========================================
echo   FIELD APP - Site Visit Data Collection
echo ========================================
echo.

cd /d "%~dp0"

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found!
    echo Please install Python from python.org
    pause
    exit /b 1
)

REM Install requirements if needed
pip show flask >nul 2>&1
if errorlevel 1 (
    echo Installing required packages...
    pip install flask flask-cors
)

echo Starting Field App...
echo.
echo ========================================
echo   Open on your PHONE:
echo   http://YOUR-COMPUTER-IP:5050
echo.
echo   Or on this computer:
echo   http://localhost:5050
echo ========================================
echo.
echo Press Ctrl+C to stop
echo.

python app.py

pause

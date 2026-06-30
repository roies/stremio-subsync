@echo off
echo Installing SubSync...
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Download it from https://nodejs.org and re-run this script.
    pause
    exit /b 1
)

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed.
    echo Download it from https://python.org and re-run this script.
    pause
    exit /b 1
)

echo Installing Python dependency ^(ffsubsync^)...
pip install ffsubsync
if %errorlevel% neq 0 (
    echo ERROR: pip install failed.
    pause
    exit /b 1
)

echo Installing Node.js dependencies...
npm install
if %errorlevel% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

echo.
echo Done! Run start.bat to launch SubSync.
pause

@echo off
echo Starting SubSync...
echo.

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set LOCAL_IP=%%a
    goto :found
)
:found
set LOCAL_IP=%LOCAL_IP: =%

echo ============================================
echo  SubSync is running!
echo.
echo  Add this URL to Stremio on any device:
echo  http://%LOCAL_IP%:7000/manifest.json
echo.
echo  In Stremio: Settings ^> Add-ons ^> paste URL
echo ============================================
echo.
echo Press Ctrl+C to stop.
echo.

node addon.js

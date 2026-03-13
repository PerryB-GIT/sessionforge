@echo off
:: setup-automation.bat
:: Run ONCE as Administrator to enable fully automated debug loop.
:: Right-click -> Run as administrator

echo ============================================
echo  SessionForge Debug Loop - One-Time Setup
echo ============================================
echo.

:: Check admin
net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Must run as Administrator.
    echo Right-click this file and choose "Run as administrator"
    pause
    exit /b 1
)

echo Registering SessionForgeSwap scheduled task...
powershell -ExecutionPolicy Bypass -File "%~dp0register-swap-task.ps1"

echo.
echo ============================================
echo  Setup complete!
echo  Now run debug-loop.ps1 from any terminal
echo  (no admin required for future runs)
echo ============================================
pause

@echo off
REM Run this as Administrator
echo Stopping SessionForgeAgent...
sc stop SessionForgeAgent
timeout /t 5 /nobreak
taskkill /IM sessionforge.exe /F 2>nul
timeout /t 2 /nobreak
echo Copying new binary...
copy /Y "C:\Users\Jakeb\sessionforge\agent\sessionforge-new.exe" "C:\Users\Jakeb\AppData\Local\Programs\sessionforge\sessionforge.exe"
echo Starting service...
sc start SessionForgeAgent
timeout /t 2 /nobreak
sc query SessionForgeAgent | findstr STATE
pause

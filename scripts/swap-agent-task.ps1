$src = "C:\Users\Jakeb\sessionforge\agent\sessionforge-new.exe"
$dst = "C:\Users\Jakeb\AppData\Local\Programs\sessionforge\sessionforge.exe"
$bak = "C:\Users\Jakeb\AppData\Local\Programs\sessionforge\sessionforge.exe.bak"
$taskName = "SessionForgeAgentUser"

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Get-Process -Name sessionforge -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2
Copy-Item $dst $bak -Force
Copy-Item $src $dst -Force
Start-ScheduledTask -TaskName $taskName
Start-Sleep 3
$proc = Get-Process -Name sessionforge -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "RUNNING (PID $($proc.Id), Session $($proc.SessionId))" -ForegroundColor Green
} else {
    Write-Host "WARN: not running" -ForegroundColor Yellow
}

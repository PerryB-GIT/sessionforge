# register-swap-task.ps1
# Run ONCE as Administrator to register the SessionForge swap task.
# After this, debug-loop.ps1 can trigger swaps without any UAC prompts.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\register-swap-task.ps1

$taskName = "SessionForgeSwap"
$swapScript = "C:\Users\Jakeb\sessionforge\scripts\do-swap-task.ps1"

# Remove existing task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -NonInteractive -File `"$swapScript`""

# Trigger: on-demand only (no schedule). Run as SYSTEM with highest privileges.
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2)

$principal = New-ScheduledTaskPrincipal `
    -UserId "NT AUTHORITY\SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Principal $principal `
    -Settings $settings `
    -Force

Write-Host ""
Write-Host "Task '$taskName' registered. Test with:" -ForegroundColor Green
Write-Host "  schtasks /run /tn SessionForgeSwap"
Write-Host ""
Write-Host "Now run debug-loop.ps1 from any non-admin shell." -ForegroundColor Green

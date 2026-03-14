# install-startup-task.ps1
# Creates a Windows Task Scheduler task that runs SessionForge agent
# as the logged-in user at login. This gives the agent a real user session
# with ConPTY support, unlike the LocalSystem service which runs in Session 0.
# Run as Administrator.

$taskName = "SessionForgeAgentUser"
$agentExe = "C:\Users\Jakeb\AppData\Local\Programs\sessionforge\sessionforge.exe"
$agentArgs = "--config-dir C:\Users\Jakeb\.sessionforge"
$userName = "$env:COMPUTERNAME\$env:USERNAME"

# Stop and disable the service — task takes over
sc.exe stop SessionForgeAgent 2>&1 | Out-Null
sc.exe config SessionForgeAgent start= disabled 2>&1 | Out-Null
Write-Host "Service disabled."

# Remove old task if exists
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create the action
$action = New-ScheduledTaskAction -Execute $agentExe -Argument $agentArgs

# Trigger: at logon of current user
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userName

# Settings: run whether on battery or not, restart on failure
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

# Principal: run as current user, interactive (gives ConPTY access)
$principal = New-ScheduledTaskPrincipal -UserId $userName -LogonType Interactive -RunLevel Limited

$task = Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force

Write-Host "Task registered: $taskName"
Write-Host "Running task now..."
Start-ScheduledTask -TaskName $taskName
Start-Sleep 3
$state = (Get-ScheduledTask -TaskName $taskName).State
Write-Host "Task state: $state"

# Verify agent process is running
$proc = Get-Process -Name sessionforge -ErrorAction SilentlyContinue
if ($proc) {
    Write-Host "SUCCESS: SessionForge agent running as user (PID $($proc.Id))" -ForegroundColor Green
    Write-Host "ConPTY will now work - full terminal emulation enabled."
} else {
    Write-Host "WARN: Agent process not found. Check task manually." -ForegroundColor Yellow
}

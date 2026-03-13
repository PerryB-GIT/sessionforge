# do-swap-task.ps1
# Runs as SYSTEM via Task Scheduler. Stops service, copies binary, restarts.
# Writes status to a flag file so the debug loop can poll for completion.

$newBin   = "C:\Users\Jakeb\sessionforge\agent\sessionforge-new.exe"
$svcBin   = "C:\Users\Jakeb\AppData\Local\Programs\sessionforge\sessionforge.exe"
$svcName  = "SessionForgeAgent"
$doneFlag = "C:\Users\Jakeb\sessionforge\scripts\.swap-done"
$errFlag  = "C:\Users\Jakeb\sessionforge\scripts\.swap-error"

# Clear old flags
Remove-Item $doneFlag -Force -ErrorAction SilentlyContinue
Remove-Item $errFlag  -Force -ErrorAction SilentlyContinue

try {
    sc.exe stop $svcName 2>&1 | Out-Null
    $stopped = $false
    for ($i = 0; $i -lt 15; $i++) {
        $state = (sc.exe query $svcName | Select-String 'STATE').ToString()
        if ($state -match 'STOPPED') { $stopped = $true; break }
        Start-Sleep 1
    }
    if (-not $stopped) {
        Stop-Process -Name sessionforge -Force -ErrorAction SilentlyContinue
        Start-Sleep 2
    }

    Copy-Item $newBin $svcBin -Force

    sc.exe start $svcName 2>&1 | Out-Null
    Start-Sleep 3

    $state = (sc.exe query $svcName | Select-String 'STATE').ToString()
    if ($state -match 'RUNNING') {
        Set-Content $doneFlag "ok"
    } else {
        Set-Content $errFlag "service did not start: $state"
    }
} catch {
    Set-Content $errFlag $_.Exception.Message
}

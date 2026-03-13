# repro-pipe-check.ps1
# Rule 1 (L009): Reproduce quickly; save the failing input.
# Minimal pipe reproduction — verifies node.exe stdout flows through a pipe
# to the parent process. If this prints nothing, the pipe is broken.
# Run BEFORE touching any service code when debugging zero-output issues.
#
# Usage: powershell scripts/repro-pipe-check.ps1

$node = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $node)) {
    $node = (Get-Command node.exe -ErrorAction SilentlyContinue)?.Source
}
if (-not $node) {
    Write-Host "SKIP: node.exe not found" -ForegroundColor Yellow
    exit 0
}

Write-Host "=== Pipe Reproduction Check ===" -ForegroundColor Cyan
Write-Host "node: $node"
Write-Host ""

# Test 1: Direct exec (should always work)
Write-Host "Test 1: Direct exec (baseline)" -ForegroundColor White
$out1 = & $node -e "process.stdout.write('PING-DIRECT\n')" 2>&1
if ($out1 -match "PING-DIRECT") {
    Write-Host "  PASS: $out1" -ForegroundColor Green
} else {
    Write-Host "  FAIL: got '$out1'" -ForegroundColor Red
}

# Test 2: Via pipe operator (catches broken stdout)
Write-Host "Test 2: Via pipe operator" -ForegroundColor White
$out2 = & $node -e "process.stdout.write('PING-PIPE\n')" | Out-String
if ($out2 -match "PING-PIPE") {
    Write-Host "  PASS: $out2" -ForegroundColor Green
} else {
    Write-Host "  FAIL: got nothing — stdout pipe is broken" -ForegroundColor Red
    Write-Host "  ROOT CAUSE: likely non-overlapped pipe handles (see L001 in tasks/lessons.md)" -ForegroundColor Yellow
}

# Test 3: With CLAUDE_CONFIG_DIR set (catches auth issues)
Write-Host "Test 3: CLAUDE_CONFIG_DIR set" -ForegroundColor White
$env:CLAUDE_CONFIG_DIR = "C:\Users\Jakeb\.claude"
$claudeJs = "C:\Users\Jakeb\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js"
if (Test-Path $claudeJs) {
    $out3 = & $node $claudeJs --dangerously-skip-permissions --print "say PONG in one word" 2>&1 | Out-String
    if ($out3 -match "PONG|pong") {
        Write-Host "  PASS: Claude responds" -ForegroundColor Green
    } else {
        Write-Host "  FAIL: '$($out3.Substring(0, [Math]::Min(120,$out3.Length)))'" -ForegroundColor Red
        Write-Host "  Check: Is .claude.json present? Is CLAUDE_CONFIG_DIR correct?" -ForegroundColor Yellow
    }
} else {
    Write-Host "  SKIP: claude cli.js not found at expected path" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Save this output as evidence before making any code changes." -ForegroundColor Cyan

 param([int]$WaitMinutes = 60)
  Set-Location (Split-Path -Parent $PSScriptRoot)
  New-Item -ItemType Directory -Force logs | Out-Null
  function Say($m){ $l="$(Get-Date -f 'yyyy-MM-dd HH:mm') $m"; Write-Host $l; Add-Content logs\goal-runner.log $l }
  $first = $true
  while ($true) {
    $goal = Get-Content docs\goal.md -Raw
    if ($goal -notmatch '(?m)^- \[ \] ') { Say "Goal complete."; break }
    if ((Test-Path docs\NEEDS-USER.md) -and (Get-Content docs\NEEDS-USER.md -Raw).Trim()) {
      Say "Waiting for answers in docs/NEEDS-USER.md"; Start-Sleep ($WaitMinutes*60); continue }
    Say "Starting Claude Code"
    $a = @("-p","/goal","--permission-mode","acceptEdits"); if (-not $first) { $a = @("--continue") + $a }
    & claude @a 2>&1 | Out-File logs\goal-last-run.log
    $first = $false
    Say "Claude Code stopped (exit $LASTEXITCODE). Retrying in $WaitMinutes min."
    Start-Sleep ($WaitMinutes*60)
  }
# Updates Britech Job Entry on the warehouse PC to the newest version on GitHub (branch main),
# then restarts it and checks that it is running. Run it in an administrator PowerShell window:
#
#   powershell -ExecutionPolicy Bypass -File C:\BritechJobEntry\app\scripts\update.ps1
#
# Options:
#   -CheckOnly        Only show what is new. Changes nothing.
#   -Yes              Do not ask "Update now?".
#   -ToCommit <id>    Go to that exact version instead (used to go back after a bad update).
#
# Every run is logged to C:\BritechJobEntry\logs\update-<date>-<time>.log.
param(
    [switch]$CheckOnly,
    [switch]$Yes,
    [string]$ToCommit = "",
    [int]$Port = 8000
)

# Native tools (git, npm, pip) print progress on stderr; check exit codes instead of stopping on it.
$ErrorActionPreference = "Continue"
$TaskName = "Britech Job Entry"
$Branch = "main"
$appRoot = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $appRoot "backend"
$frontend = Join-Path $appRoot "frontend"
$python = Join-Path $backend ".venv\Scripts\python.exe"
$logDir = Join-Path (Split-Path -Parent $appRoot) "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("update-{0:yyyy-MM-dd-HHmm}.log" -f (Get-Date))
try { Start-Transcript -Path $log -Append | Out-Null } catch { }

$script:stepNo = 0
function Step([string]$text) {
    $script:stepNo++
    Write-Host ""
    Write-Host ("[{0}] {1}" -f $script:stepNo, $text) -ForegroundColor Cyan
}
function Ok([string]$text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Note([string]$text) { Write-Host "    $text" }
function Finish([int]$code) {
    Write-Host ""
    Write-Host "Log saved to $log"
    try { Stop-Transcript | Out-Null } catch { }
    exit $code
}
function Fail([string]$text, [string[]]$fix = @()) {
    Write-Host ""
    Write-Host "UPDATE STOPPED: $text" -ForegroundColor Red
    foreach ($line in $fix) { Write-Host "  $line" -ForegroundColor Yellow }
    Finish 1
}
function Short([string]$commit) { (& git log -1 --format="%h  %s  (%cd)" --date=short $commit) }

Set-Location $appRoot

# ---------------------------------------------------------------------------------------------
Step "Checking this copy of the app"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Fail "Git is not installed or not on PATH." @("Install it (winget install Git.Git), reopen PowerShell, and run this again.")
}
if (-not (Test-Path $python)) {
    Fail "Python environment not found at $python." @("Follow docs\warehouse_pc_setup.md step 4 first.")
}
$current = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($current -ne $Branch) {
    Fail "This copy is on branch '$current', not '$Branch'." @(
        "Switch back with:  git -C `"$appRoot`" switch $Branch",
        "Then run this script again."
    )
}
$dirty = & git status --porcelain --untracked-files=no
if ($dirty) {
    Write-Host "    Files changed on this PC:" -ForegroundColor Yellow
    $dirty | ForEach-Object { Write-Host "      $_" -ForegroundColor Yellow }
    Fail "Files in the app folder were edited on this PC, so updating could overwrite them." @(
        "If nobody meant to change them, undo the edits with:  git -C `"$appRoot`" checkout -- .",
        "Then run this script again. (.env is not affected; it is not tracked.)"
    )
}
Ok "On branch $Branch with no local edits."

Step "Getting the newest version list from GitHub"
& git fetch --quiet origin $Branch
if ($LASTEXITCODE -ne 0) {
    Fail "Could not reach GitHub." @("Check the internet connection. If Git asks you to sign in, sign in and run this again.")
}
$old = (& git rev-parse HEAD).Trim()
if ($ToCommit) {
    $target = (& git rev-parse --verify --quiet "$ToCommit^{commit}")
    if (-not $target) { Fail "Version '$ToCommit' was not found." @("Use the id printed by an earlier update, e.g. 1a2b3c4.") }
    $target = $target.Trim()
} else {
    $target = (& git rev-parse "origin/$Branch").Trim()
    & git merge-base --is-ancestor $old $target
    if ($LASTEXITCODE -ne 0) {
        Fail "This PC has versions that are not on GitHub, so it cannot update automatically." @(
            "Ask whoever maintains the app to look at it, or go to the GitHub version with:",
            "  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ToCommit origin/$Branch"
        )
    }
}
Note ("Running now:  " + (Short $old))
if ($old -eq $target) {
    Ok "Already up to date. Nothing to do."
    Finish 0
}
if ($ToCommit) {
    Note ("Going to:     " + (Short $target))
} else {
    Note "New since the running version:"
    & git log --no-decorate --date=short --format="      %h  %s  (%cd)" "$old..$target"
}
if ($CheckOnly) {
    Ok "Check only: nothing was changed."
    Finish 0
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Fail "The '$TaskName' scheduled task was not found (or this window cannot see it)." @(
        "Close this window, open PowerShell with 'Run as administrator', and run this again.",
        "If it is still missing, set it up with docs\warehouse_pc_setup.md step 10."
    )
}

if (-not $Yes) {
    Write-Host ""
    $answer = Read-Host "Update now? The app restarts and is unavailable for about a minute. (Y/N)"
    if ($answer -notmatch '^(y|yes)$') {
        Note "Cancelled. Nothing was changed."
        Finish 0
    }
}

# ---------------------------------------------------------------------------------------------
function Install-Version([string]$commit) {
    Step "Switching the code to $((& git rev-parse --short $commit).Trim())"
    & git reset --quiet --hard $commit | Out-Host
    if ($LASTEXITCODE -ne 0) { return "Switching the code" }
    Ok (Short $commit)

    Step "Installing Python packages"
    & $python -m pip install --quiet --disable-pip-version-check -r (Join-Path $backend "requirements.txt") | Out-Host
    if ($LASTEXITCODE -ne 0) { return "Installing Python packages" }
    Ok "Python packages installed."

    Step "Building the website (about a minute)"
    Push-Location $frontend
    & npm.cmd ci --no-audit --no-fund --loglevel=error | Out-Host
    $ciCode = $LASTEXITCODE
    $buildCode = 1
    if ($ciCode -eq 0) {
        & npm.cmd run build --silent | Out-Host
        $buildCode = $LASTEXITCODE
    }
    Pop-Location
    if ($ciCode -ne 0) { return "Installing website packages (npm ci)" }
    if ($buildCode -ne 0) { return "Building the website (npm run build)" }
    Ok "Website built."
    return $null
}

function Start-And-Check {
    Step "Starting the app"
    Start-ScheduledTask -TaskName $TaskName | Out-Null
    $url = "http://localhost:$Port/api/health"
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 2
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                Ok "The app is answering at http://localhost:$Port"
                return $true
            }
        } catch { }
    }
    return $false
}

Step "Stopping the app"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "stop_server.ps1") -Port $Port
if ($LASTEXITCODE -ne 0) {
    Fail "Could not stop the app." @("Close any window running the server and run this again. Nothing was changed.")
}

$failedStep = Install-Version $target
if ($failedStep) {
    Write-Host ""
    Write-Host "UPDATE FAILED at: $failedStep (see the lines above)." -ForegroundColor Red
    Write-Host "The app is stopped. Going back to the version that was running..." -ForegroundColor Yellow
    $rollbackFailed = Install-Version $old
    if ($rollbackFailed) {
        Fail "Going back also failed at: $rollbackFailed. The app is stopped." @(
            "Send this log to whoever maintains the app: $log"
        )
    }
    if (-not (Start-And-Check)) {
        Fail "The previous version did not start." @("Read the newest file in $logDir (server-*.log).")
    }
    Fail "The update did not install, so the previous version is running again." @(
        "Send this log to whoever maintains the app: $log"
    )
}

if (-not (Start-And-Check)) {
    Write-Host ""
    Write-Host "The new version did not start within 90 seconds." -ForegroundColor Red
    Fail "Check the newest server log in $logDir (server-*.log)." @(
        "To go back to the version that was running before:",
        "  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ToCommit $((& git rev-parse --short $old).Trim()) -Yes"
    )
}

try {
    $print = Invoke-RestMethod -Uri "http://localhost:$Port/api/print/status" -TimeoutSec 5
    if ($print.enabled) {
        Note ("Direct printing: on (" + $print.documents.traveler.printer + ").")
    } else {
        Note ("Direct printing: off - " + $print.reason)
    }
} catch { }

Write-Host ""
Write-Host ("UPDATED: " + (Short $target)) -ForegroundColor Green
Write-Host "If something is wrong with this version, go back with:"
Write-Host ("  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -ToCommit " + (& git rev-parse --short $old).Trim() + " -Yes")
Finish 0

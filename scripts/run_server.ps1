# Starts the Britech Job Entry server (API + built website) on port 8000.
# Used by the "Britech Job Entry" scheduled task; can also be run by hand.
param(
    [int]$Port = 8000,
    [string]$LogDir = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "logs")
)

$appRoot = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $appRoot "backend"
$python = Join-Path $backend ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Write-Error "Python virtual environment not found at $python. See docs\warehouse_pc_setup.md step 4."
    exit 1
}
if (-not (Test-Path (Join-Path $appRoot "frontend\dist\index.html"))) {
    Write-Warning "frontend\dist is missing; the website will not load until you run: npm run build (in frontend)."
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$log = Join-Path $LogDir ("server-{0:yyyy-MM}.log" -f (Get-Date))

Set-Location $backend
# cmd handles the redirect so uvicorn's stderr logging is not turned into PowerShell errors.
cmd /c "`"$python`" -m uvicorn app.main:app --host 0.0.0.0 --port $Port >> `"$log`" 2>&1"
exit $LASTEXITCODE

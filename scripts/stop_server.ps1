# Stops the Britech Job Entry server by ending whatever is listening on its port.
param([int]$Port = 8000)

Stop-ScheduledTask -TaskName "Britech Job Entry" -ErrorAction SilentlyContinue

$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listeners) {
    Write-Host "Nothing is running on port $Port."
    exit 0
}
$listeners | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    Write-Error "Port $Port is still in use."
    exit 1
}
Write-Host "Server stopped."

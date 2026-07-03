$ErrorActionPreference = "Stop"

$agentDir = "C:\Program Files (x86)\ossec-agent"
$confPath = Join-Path $agentDir "ossec.conf"
$keysPath = Join-Path $agentDir "client.keys"
$keysSavePath = Join-Path $agentDir "client.keys.save"
$manager = "127.0.0.1"
$agentName = $env:COMPUTERNAME

Write-Host "Repairing local Wazuh agent enrollment..." -ForegroundColor Cyan

if (-not (Test-Path $agentDir)) {
    throw "Wazuh agent directory not found: $agentDir"
}

if (Get-Service -Name WazuhSvc -ErrorAction SilentlyContinue) {
    Stop-Service -Name WazuhSvc -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

if ((Test-Path $keysSavePath) -and ((Get-Item $keysSavePath).Length -gt 0)) {
    Copy-Item -LiteralPath $keysSavePath -Destination $keysPath -Force
    Write-Host "Restored client.keys from client.keys.save" -ForegroundColor Green
} else {
    & (Join-Path $agentDir "agent-auth.exe") -m $manager -A $agentName
    Write-Host "Ran agent-auth against $manager as $agentName" -ForegroundColor Green
}

if (Test-Path $confPath) {
    $conf = Get-Content -LiteralPath $confPath -Raw
    $conf = [regex]::Replace($conf, "<address>.*?</address>", "<address>$manager</address>", 1)
    Set-Content -LiteralPath $confPath -Value $conf -Encoding UTF8
    Write-Host "Set Wazuh manager address to $manager" -ForegroundColor Green
}

Start-Service -Name WazuhSvc
Start-Sleep -Seconds 5

$svc = Get-Service -Name WazuhSvc
Write-Host "Wazuh service status: $($svc.Status)" -ForegroundColor Green
Write-Host "Done. You can close this window." -ForegroundColor Cyan
Start-Sleep -Seconds 5

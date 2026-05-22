#Requires -Version 5.1
<#
.SYNOPSIS
    SOC Portal — Interactive Setup & Management (Windows)
.DESCRIPTION
    First run: asks a few questions then builds and starts the full stack.
    Subsequent runs: management commands (stop, restart, status, logs...).
.USAGE
    .\setup.ps1 [start|stop|restart|status|logs|reconfigure|pull-model|update|backup]
#>
param(
    [string]$Command = "start",
    [string]$Arg     = "",
    [string]$Arg2    = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ── Output helpers ────────────────────────────────────────────────────
function Write-Banner {
    Write-Host ""
    $lines = @(
        "  ███████╗ ██████╗  ██████╗    ██████╗  ██████╗ ██████╗ ████████╗ █████╗ ██╗",
        "  ██╔════╝██╔═══██╗██╔════╝    ██╔══██╗██╔═══██╗██╔══██╗╚══██╔══╝██╔══██╗██║",
        "  ███████╗██║   ██║██║         ██████╔╝██║   ██║██████╔╝   ██║   ███████║██║",
        "  ╚════██║██║   ██║██║         ██╔═══╝ ██║   ██║██╔══██╗   ██║   ██╔══██║██║",
        "  ███████║╚██████╔╝╚██████╗    ██║     ╚██████╔╝██║  ██║   ██║   ██║  ██║███████╗",
        "  ╚══════╝ ╚═════╝  ╚═════╝    ╚═╝      ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝"
    )
    foreach ($l in $lines) { Write-Host $l -ForegroundColor Cyan }
    Write-Host ""
    Write-Host "  LLM-Enabled Security Operations Center" -ForegroundColor White
    Write-Host "  Wazuh  Grafana  OpenCTI  Velociraptor  Ollama" -ForegroundColor DarkGray
    Write-Host ""
}

function Write-Heading([string]$Text) {
    Write-Host ""
    Write-Host "  -- $Text" -ForegroundColor Yellow
    Write-Host "  $('-' * ($Text.Length + 4))" -ForegroundColor DarkGray
}

function Write-Ok([string]$Text)   { Write-Host "  [OK] $Text" -ForegroundColor Green }
function Write-Info([string]$Text) { Write-Host "  [ ] $Text"  -ForegroundColor Cyan }
function Write-Warn([string]$Text) { Write-Host "  [!] $Text"  -ForegroundColor Yellow }
function Write-Err([string]$Text)  { Write-Host "  [X] $Text"  -ForegroundColor Red }

# ── Input helpers ─────────────────────────────────────────────────────
function Read-Input {
    param(
        [string]$Prompt,
        [string]$Default    = "",
        [switch]$IsPassword
    )
    if ($Default) {
        Write-Host "  $Prompt [$Default]: " -ForegroundColor White -NoNewline
    } else {
        Write-Host "  ${Prompt}: " -ForegroundColor White -NoNewline
    }

    if ($IsPassword) {
        $ss  = Read-Host -AsSecureString
        $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
        try   { $val = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
        finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
        if ([string]::IsNullOrWhiteSpace($val)) { return $Default }
        return $val
    } else {
        $val = Read-Host
        if ([string]::IsNullOrWhiteSpace($val)) { return $Default }
        return $val
    }
}

function Read-Confirm([string]$Prompt) {
    $ans = Read-Input "$Prompt (y/n)" "y"
    return ($ans -match '^[Yy]$')
}

# ── Crypto helpers ────────────────────────────────────────────────────
function New-RandomPassword {
    $chars  = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#%^&*'
    $rng    = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes  = New-Object byte[] 20
    $rng.GetBytes($bytes)
    return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function New-RandomHex {
    $rng   = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    return ([System.BitConverter]::ToString($bytes) -replace '-', '').ToLower()
}

function New-RandomUUID { return [System.Guid]::NewGuid().ToString() }

function ConvertTo-Base64String([string]$Text) {
    return [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Text))
}

# ── Network helpers ───────────────────────────────────────────────────
function Get-LocalIP {
    try {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -notmatch '^127\.' -and
                $_.IPAddress -notmatch '^169\.254\.' -and
                $_.PrefixOrigin -in ('Manual','Dhcp')
            } | Select-Object -First 1).IPAddress
        return $ip
    } catch {
        return ""
    }
}

function Get-PhysicalInterfaces {
    try {
        return @(Get-NetAdapter -Physical -ErrorAction Stop |
            Where-Object { $_.Status -eq "Up" } |
            Select-Object -ExpandProperty Name)
    } catch {
        return @("Ethernet", "Wi-Fi")
    }
}

# ── .env helpers ─────────────────────────────────────────────────────
function Update-EnvVar([string]$Key, [string]$Value) {
    if (Test-Path ".env") {
        $lines = Get-Content ".env"
        $found = $false
        $lines = $lines | ForEach-Object {
            if ($_ -match "^$Key=") { "$Key=$Value"; $found = $true } else { $_ }
        }
        if (-not $found) { $lines += "$Key=$Value" }
        [System.IO.File]::WriteAllLines(
            (Join-Path $PWD ".env"),
            $lines,
            [System.Text.UTF8Encoding]::new($false)
        )
    }
}

function Set-PacketCaptureEnabled([bool]$Enabled) {
    Update-EnvVar "ENABLE_PACKET_CAPTURE" (if ($Enabled) { "true" } else { "false" })
}

# ── Prerequisites ─────────────────────────────────────────────────────
function Test-Prerequisites {
    Write-Heading "Checking prerequisites"
    $ok = $true

    # Docker
    $dockerOut = docker --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Docker: $dockerOut"
    } else {
        Write-Err "Docker not found."
        Write-Info "Install Docker Desktop: https://docs.docker.com/get-docker/"
        $ok = $false
    }

    # Docker Compose
    $composeOut = docker compose version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Docker Compose: $composeOut"
    } else {
        Write-Err "Docker Compose not found."
        $ok = $false
    }

    if (-not $ok) {
        Write-Host ""
        Write-Err "Fix the above issues then re-run."
        exit 1
    }
}

# ── Setup wizard ──────────────────────────────────────────────────────
function Invoke-SetupWizard {
    Write-Heading "First-time setup wizard"
    Write-Host ""
    Write-Host "  I'll ask a few questions then build and start everything." -ForegroundColor White
    Write-Host "  Press Enter to accept the [default]." -ForegroundColor DarkGray
    Write-Host ""

    # ── Server IP ─────────────────────────────────────────────────────
    Write-Heading "Server address"
    Write-Host "  The IP/hostname remote agents use to reach this server." -ForegroundColor DarkGray
    Write-Host ""
    $autoIp   = Get-LocalIP
    $defaultIp = if ($autoIp) { $autoIp } else { "192.168.1.100" }
    $ServerIP  = Read-Input "Server IP or hostname" $defaultIp
    Write-Ok "Server address: $ServerIP"
    Write-Host ""

    # ── Network interface ──────────────────────────────────────────────
    Write-Heading "Network interface (Zeek/Suricata packet capture)"
    $ifaces = Get-PhysicalInterfaces
    Write-Host "  Available interfaces:" -ForegroundColor DarkGray
    for ($i = 0; $i -lt $ifaces.Count; $i++) {
        Write-Host "    $($i+1)) $($ifaces[$i])" -ForegroundColor Cyan
    }
    Write-Host ""
    $ifChoice = Read-Input "Interface name or number" "1"
    $NetIface = if ($ifChoice -match '^\d+$') {
        $idx = [int]$ifChoice - 1
        if ($idx -ge 0 -and $idx -lt $ifaces.Count) { $ifaces[$idx] } else { $ifaces[0] }
    } else { $ifChoice }
    Write-Ok "Using interface: $NetIface"
    Write-Host ""

    # ── Packet capture ────────────────────────────────────────────────
    Write-Heading "Packet capture (Zeek / Suricata IDS)"
    Write-Warn "Requires Linux with network_mode: host"
    Write-Warn "NOT supported on Docker Desktop (Windows/Mac)"
    Write-Host ""
    $EnableIDS    = Read-Confirm "Enable Zeek and Suricata for packet capture?"
    $EnableIDSStr = if ($EnableIDS) { "true" } else { "false" }
    Write-Ok "Packet capture: $EnableIDSStr"
    Write-Host ""

    # ── LLM model ─────────────────────────────────────────────────────
    Write-Heading "LLM model (AI-assisted threat analysis)"
    Write-Host "  1) llama3.2:3b   - 2 GB RAM  [recommended]" -ForegroundColor Cyan
    Write-Host "  2) phi3:mini     - 2 GB RAM, very fast"      -ForegroundColor Cyan
    Write-Host "  3) mistral:7b    - 5 GB RAM, better quality" -ForegroundColor Cyan
    Write-Host "  4) llama3.1:8b   - 6 GB RAM, best quality"   -ForegroundColor Cyan
    Write-Host ""
    $llmChoice = Read-Input "Model name or number" "1"
    $LlmModel  = switch ($llmChoice) {
        "1"  { "llama3.2:3b" }
        "2"  { "phi3:mini"   }
        "3"  { "mistral:7b"  }
        "4"  { "llama3.1:8b" }
        ""   { "llama3.2:3b" }
        default { $llmChoice }
    }
    Write-Ok "LLM model: $LlmModel"
    Write-Host ""

    # ── OpenCTI email ──────────────────────────────────────────────────
    Write-Heading "OpenCTI admin account"
    $OpenCtiEmail = Read-Input "Admin email" "admin@soc.local"
    Write-Host ""

    # ── Passwords ─────────────────────────────────────────────────────
    Write-Heading "Passwords"
    Write-Host "  A) Auto-generate all passwords  [recommended]" -ForegroundColor White
    Write-Host "  B) Set passwords manually"                     -ForegroundColor White
    Write-Host ""
    $autoPass = Read-Confirm "Auto-generate all passwords?"

    if ($autoPass) {
        $PortalPass       = New-RandomPassword
        $WazuhApiPass     = New-RandomPassword
        $WazuhIndexerPass = New-RandomPassword
        $WazuhDashPass    = New-RandomPassword
        $GrafanaPass      = New-RandomPassword
        $OpenCtiPass      = New-RandomPassword
        $RabbitPass       = New-RandomPassword
        $MinioPass        = New-RandomPassword
        $VeloPass         = New-RandomPassword
        Write-Ok "All passwords generated"
    } else {
        Write-Host ""
        Write-Host "  (Press Enter to keep the shown default)" -ForegroundColor DarkGray
        Write-Host ""
        $PortalPass       = Read-Input "Portal admin password"      "ChangeThisPortalPassword1!"   -IsPassword
        $WazuhApiPass     = Read-Input "Wazuh API password"          "ChangeThisWazuhPassword1!"    -IsPassword
        $WazuhIndexerPass = Read-Input "Wazuh Indexer password"      "ChangeThisIndexerPassword1!"  -IsPassword
        $WazuhDashPass    = Read-Input "Wazuh Dashboard password"    "ChangeThisDashboardPassword1!" -IsPassword
        $GrafanaPass      = Read-Input "Grafana password"            "ChangeThisGrafanaPassword1!"  -IsPassword
        $OpenCtiPass      = Read-Input "OpenCTI admin password"      "ChangeThisOpenCTI1!"          -IsPassword
        $RabbitPass       = Read-Input "OpenCTI RabbitMQ password"   "ChangeThisRabbitMQ1!"         -IsPassword
        $MinioPass        = Read-Input "OpenCTI MinIO password"      "ChangeThisMinio1!"            -IsPassword
        $VeloPass         = Read-Input "Velociraptor admin password" "ChangeThisVelo1!"             -IsPassword
    }

    # ── Generate secrets ───────────────────────────────────────────────
    Write-Heading "Generating cryptographic secrets"
    $JwtSecret    = New-RandomHex
    Write-Ok "JWT secret (64-char hex)"
    $OpenCtiToken = New-RandomUUID
    Write-Ok "OpenCTI admin token (UUID)"
    $WazuhB64     = ConvertTo-Base64String "admin:$WazuhIndexerPass"
    Write-Ok "Wazuh Basic Auth header (nginx proxy)"

    # ── Write .env ─────────────────────────────────────────────────────
    Write-Heading "Writing configuration"

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $envContent = @"
# ============================================================
# SOC Portal -- Environment Configuration
# Generated by setup.ps1 on $timestamp
# WARNING: NEVER commit this file to version control.
# ============================================================

# -- Portal auth -----------------------------------------------
JWT_SECRET=$JwtSecret
PORTAL_USER=admin
PORTAL_PASS=$PortalPass

# -- Wazuh -----------------------------------------------------
WAZUH_API_PASSWORD=$WazuhApiPass
WAZUH_INDEXER_PASSWORD=$WazuhIndexerPass
WAZUH_DASHBOARD_PASSWORD=$WazuhDashPass
# Base64 of "admin:<WAZUH_INDEXER_PASSWORD>" -- used by nginx proxy header
WAZUH_BASIC_AUTH_B64=$WazuhB64
WAZUH_TLS_SKIP_VERIFY=false

# -- Grafana ---------------------------------------------------
GRAFANA_USER=admin
GRAFANA_PASSWORD=$GrafanaPass

# -- OpenCTI ---------------------------------------------------
OPENCTI_ADMIN_EMAIL=$OpenCtiEmail
OPENCTI_ADMIN_PASSWORD=$OpenCtiPass
OPENCTI_ADMIN_TOKEN=$OpenCtiToken
OPENCTI_RABBITMQ_USER=opencti
OPENCTI_RABBITMQ_PASS=$RabbitPass
OPENCTI_MINIO_USER=opencti
OPENCTI_MINIO_PASS=$MinioPass

# -- Velociraptor ----------------------------------------------
VELOCIRAPTOR_ADMIN_PASSWORD=$VeloPass

# -- Ollama LLM ------------------------------------------------
OLLAMA_MODEL=$LlmModel

# -- Network ---------------------------------------------------
SOC_NETWORK_INTERFACE=$NetIface
SERVER_IP=$ServerIP

# -- Packet capture --------------------------------------------
ENABLE_PACKET_CAPTURE=$EnableIDSStr
"@

    # Write UTF-8 without BOM so Docker can read it
    [System.IO.File]::WriteAllText(
        (Join-Path $PWD ".env"),
        $envContent,
        [System.Text.UTF8Encoding]::new($false)
    )
    Write-Ok ".env written"

    # ── Credentials summary ────────────────────────────────────────────
    $credsContent = @"
==================================================================
  SOC Portal -- Access Credentials
  Generated: $timestamp
==================================================================

  SOC Portal        https://$ServerIP
  Username:         admin
  Password:         $PortalPass

  Grafana           https://$ServerIP/grafana
  Username:         admin
  Password:         $GrafanaPass

  Wazuh Dashboard   https://$ServerIP/wazuh
  Username:         admin
  Password:         $WazuhIndexerPass

  OpenCTI           https://$ServerIP/opencti
  Email:            $OpenCtiEmail
  Password:         $OpenCtiPass
  API Token:        $OpenCtiToken

  Velociraptor      https://$ServerIP`:8889
  Username:         admin
  Password:         $VeloPass

  Wazuh Agent Enrollment
  Manager IP:       $ServerIP
  Enroll port:      1515
  Events port:      1514

==================================================================
  ! STORE THIS FILE SAFELY -- DELETE AFTER RECORDING PASSWORDS !
==================================================================
"@

    [System.IO.File]::WriteAllText(
        (Join-Path $PWD "credentials.txt"),
        $credsContent,
        [System.Text.UTF8Encoding]::new($false)
    )
    Write-Warn "Credentials saved to credentials.txt"
    Write-Host ""
}

# ── Health wait ───────────────────────────────────────────────────────
function Wait-ContainerHealthy {
    param([string]$Container, [int]$Timeout = 90)
    $elapsed = 0
    Write-Host "  [ ] Waiting for $Container..." -ForegroundColor Cyan -NoNewline
    while ($elapsed -lt $Timeout) {
        $status = docker inspect --format="{{.State.Health.Status}}" $Container 2>$null
        switch ($status) {
            "healthy" {
                Write-Host "`r  [OK] $Container is healthy          " -ForegroundColor Green
                return
            }
            { $_ -in "starting", "" } {
                Start-Sleep -Seconds 5
                $elapsed += 5
                Write-Host "`r  [ ] Waiting for $Container... (${elapsed}s)" -ForegroundColor Cyan -NoNewline
            }
            default {
                Write-Host "`r  [!] $Container status: $status -- continuing" -ForegroundColor Yellow
                return
            }
        }
    }
    Write-Host "`r  [!] $Container not healthy after ${Timeout}s -- continuing" -ForegroundColor Yellow
}

# ── Commands ──────────────────────────────────────────────────────────
function Start-Platform {
    Write-Banner
    Test-Prerequisites

    if (-not (Test-Path ".env")) {
        Invoke-SetupWizard
        Write-Host ""
        $go = Read-Confirm "Start the platform now?"
        if (-not $go) {
            Write-Info "Run: .\setup.ps1 start   when you are ready."
            return
        }
    }

    Write-Heading "Starting SOC Platform"
    Write-Info "Building images and starting containers..."
    Write-Info "First run may take 10-20 minutes (image downloads + LLM model pull)."
    Write-Host ""

    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) {
        Write-Err "docker compose failed. Check logs: .\setup.ps1 logs"
        exit 1
    }

    $idsEnabled = ""
    if (Test-Path ".env") {
        $idsEnabled = (Get-Content ".env" |
            Where-Object { $_ -match "^ENABLE_PACKET_CAPTURE=" } |
            ForEach-Object { $_ -replace "^ENABLE_PACKET_CAPTURE=", "" } |
            Select-Object -First 1)
    }
    if ($idsEnabled -eq "true") {
        $idsIface = (Get-Content ".env" |
            Where-Object { $_ -match "^SOC_NETWORK_INTERFACE=" } |
            ForEach-Object { $_ -replace "^SOC_NETWORK_INTERFACE=", "" } |
            Select-Object -First 1)
        Write-Info "Packet capture (Zeek/Suricata) active on interface: $idsIface"
    } else {
        docker compose stop zeek suricata 2>$null
        Write-Info "Packet capture (Zeek/Suricata) skipped -- use: .\setup.ps1 packet-capture start"
    }

    Write-Heading "Waiting for core services"
    Wait-ContainerHealthy "soc-wazuh-indexer" 150
    Wait-ContainerHealthy "soc-portal"         60
    Wait-ContainerHealthy "soc-grafana"        30

    $serverIp = ""
    if (Test-Path ".env") {
        $serverIp = (Get-Content ".env" |
            Where-Object { $_ -match "^SERVER_IP=" } |
            ForEach-Object { $_ -replace "^SERVER_IP=", "" } |
            Select-Object -First 1)
    }
    if ([string]::IsNullOrWhiteSpace($serverIp)) { $serverIp = "<your-server-ip>" }

    Write-Host ""
    Write-Host "  ============================================================" -ForegroundColor Green
    Write-Host "                SOC PORTAL IS RUNNING                        " -ForegroundColor Green
    Write-Host "  ============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  SOC Portal:      https://$serverIp"          -ForegroundColor Cyan
    Write-Host "  Grafana:         https://$serverIp/grafana"  -ForegroundColor Cyan
    Write-Host "  Wazuh:           https://$serverIp/wazuh"    -ForegroundColor Cyan
    Write-Host "  OpenCTI:         https://$serverIp/opencti"  -ForegroundColor Cyan
    Write-Host "  Velociraptor:    https://${serverIp}:8889"   -ForegroundColor Cyan
    Write-Host "  Prometheus:      https://$serverIp/prometheus" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Credentials:     credentials.txt" -ForegroundColor Yellow
    Write-Host ""
    Write-Warn "Wazuh indexer needs ~2 min to become fully healthy."
    Write-Warn "Ollama pulls the LLM model in the background (~2 GB)."
    Write-Warn "OpenCTI takes 3-5 min to initialize on first run."
    Write-Host ""
    Write-Info "Monitor: .\setup.ps1 logs"
    Write-Info "Status:  .\setup.ps1 status"
    Test-DiskSaturation 80
}

function Stop-Platform {
    Write-Info "Stopping SOC Platform..."
    docker compose down
    Write-Ok "All containers stopped"
}

function Restart-Platform {
    Write-Info "Restarting SOC Platform..."
    docker compose down
    Start-Sleep -Seconds 2
    Start-Platform
}

function Show-Status {
    Test-DiskSaturation 80
    Write-Host ""
    Write-Host "  Container Status" -ForegroundColor White
    Write-Host ""
    docker compose ps
}

function Show-Logs([string]$Service = "") {
    if ([string]::IsNullOrWhiteSpace($Service)) {
        docker compose logs -f --tail=50
    } else {
        docker compose logs -f --tail=100 $Service
    }
}

function Pull-LlmModel([string]$Model = "") {
    if ([string]::IsNullOrWhiteSpace($Model)) {
        Write-Host ""
        Write-Host "  1) llama3.2:3b   - 2 GB" -ForegroundColor Cyan
        Write-Host "  2) phi3:mini     - 2 GB, very fast" -ForegroundColor Cyan
        Write-Host "  3) mistral:7b    - 5 GB, better quality" -ForegroundColor Cyan
        Write-Host "  4) llama3.1:8b   - 6 GB, best quality" -ForegroundColor Cyan
        Write-Host ""
        $choice = Read-Input "Model name or number" "1"
        $Model  = switch ($choice) {
            "1"  { "llama3.2:3b" }
            "2"  { "phi3:mini"   }
            "3"  { "mistral:7b"  }
            "4"  { "llama3.1:8b" }
            ""   { "llama3.2:3b" }
            default { $choice }
        }
    }
    Write-Info "Pulling model: $Model  (may take several minutes...)"
    docker exec soc-ollama ollama pull $Model
    # Update .env
    if (Test-Path ".env") {
        $env = Get-Content ".env"
        $env = $env -replace "^OLLAMA_MODEL=.*", "OLLAMA_MODEL=$Model"
        [System.IO.File]::WriteAllLines(
            (Join-Path $PWD ".env"),
            $env,
            [System.Text.UTF8Encoding]::new($false)
        )
    }
    Write-Ok "Model $Model ready."
    Write-Warn "Run: .\setup.ps1 restart   to apply"
}

function Update-Platform {
    Write-Info "Pulling latest Docker images..."
    docker compose pull
    docker compose up -d --build
    Write-Ok "Update complete"
}

function Backup-Platform {
    $ts  = Get-Date -Format "yyyyMMdd_HHmmss"
    $out = "backup_$ts"
    Write-Info "Creating backup: $out"
    if (Get-Command tar -ErrorAction SilentlyContinue) {
        tar -czf "$out.tar.gz" configs/ .env 2>$null
        Write-Ok "Backup saved: $out.tar.gz"
    } else {
        $items = @("configs", ".env") | Where-Object { Test-Path $_ }
        Compress-Archive -Path $items -DestinationPath "$out.zip" -Force
        Write-Ok "Backup saved: $out.zip"
    }
}

function Reset-PortalPassword {
    if (-not (Test-Path ".env")) {
        Write-Err ".env not found -- run: .\setup.ps1 start  first"
        return
    }

    $user = (Get-Content ".env" | Where-Object { $_ -match "^PORTAL_USER=" } | ForEach-Object { $_ -replace "^PORTAL_USER=", "" } | Select-Object -First 1)
    $pass = (Get-Content ".env" | Where-Object { $_ -match "^PORTAL_PASS=" } | ForEach-Object { $_ -replace "^PORTAL_PASS=", "" } | Select-Object -First 1)
    if ([string]::IsNullOrWhiteSpace($user)) { $user = "admin" }

    Write-Heading "Reset portal admin password"

    if ([string]::IsNullOrWhiteSpace($pass)) {
        Write-Warn "PORTAL_PASS not found in .env -- enter a new password"
        $pass = Read-Input "New password for '$user'" "" -IsPassword
        if ([string]::IsNullOrWhiteSpace($pass)) {
            Write-Err "Password cannot be empty"
            return
        }
        Update-EnvVar "PORTAL_PASS" $pass
        Write-Ok ".env updated"
    }

    Write-Info "Resetting password for user: $user"

    $script = @"
const b = require('bcryptjs');
const D = require('better-sqlite3');
const db = new D(require('path').join(process.env.DATA_DIR||'/app/data','soc.db'));
const hash = b.hashSync('$pass', 10);
const u = '$user';
const exists = db.prepare('SELECT id FROM users WHERE username=?').get(u);
if (exists) {
  db.prepare('UPDATE users SET password=? WHERE username=?').run(hash, u);
  console.log('Password updated for:', u);
} else {
  db.prepare('INSERT INTO users (username,password,role) VALUES (?,?,?)').run(u, hash, 'admin');
  console.log('Admin user created:', u);
}
db.close();
"@

    docker exec soc-portal node -e $script
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Done -- login with username '$user' and the password from credentials.txt"
    } else {
        Write-Err "Failed -- is soc-portal running? Check: .\setup.ps1 status"
    }
}

function Invoke-Reconfigure {
    Write-Warn "This will delete .env and re-run the wizard."
    Write-Host ""
    $sure = Read-Confirm "Are you sure?"
    if (-not $sure) { Write-Info "Aborted."; return }
    Remove-Item ".env"           -Force -ErrorAction SilentlyContinue
    Remove-Item "credentials.txt" -Force -ErrorAction SilentlyContinue
    Invoke-SetupWizard
    $go = Read-Confirm "Start the platform now?"
    if ($go) { Start-Platform }
}

function Test-DiskSaturation {
    param([int]$Threshold = 80)
    try {
        $drive = Get-PSDrive (Split-Path $PWD -Qualifier).TrimEnd(':') -ErrorAction Stop
        if (($drive.Used + $drive.Free) -gt 0) {
            $pct = [math]::Round($drive.Used / ($drive.Used + $drive.Free) * 100)
            if ($pct -ge $Threshold) {
                Write-Warn "Disk at ${pct}% capacity -- run: .\setup.ps1 export-data  to free space"
            }
        }
    } catch {}
}

function Show-DiskUsage {
    Write-Heading "Disk & Volume Usage"
    Write-Host ""
    Write-Info "Host filesystem:"
    try {
        $drive   = Get-PSDrive (Split-Path $PWD -Qualifier).TrimEnd(':') -ErrorAction Stop
        $usedGB  = [math]::Round($drive.Used / 1GB, 1)
        $freeGB  = [math]::Round($drive.Free / 1GB, 1)
        $totalGB = $usedGB + $freeGB
        $pct     = if ($totalGB -gt 0) { [math]::Round($usedGB / $totalGB * 100) } else { 0 }
        Write-Host "    Used: ${usedGB}GB / ${totalGB}GB  (${pct}% used, ${freeGB}GB free)" -ForegroundColor White
    } catch { Write-Warn "Could not read drive info" }
    Write-Host ""
    Write-Info "Docker system:"
    docker system df
    Test-DiskSaturation 80
}

function Export-SocData {
    param([int]$Days = 30)

    $ts      = Get-Date -Format "yyyyMMdd_HHmmss"
    $outName = "soc-export-$ts"
    $outRoot = Join-Path $PWD "exports"
    $outDir  = Join-Path $outRoot $outName

    Write-Heading "SOC Data Export -- logs older than $Days days"
    Write-Host ""

    try {
        $drive   = Get-PSDrive (Split-Path $PWD -Qualifier).TrimEnd(':') -ErrorAction Stop
        $usedGB  = [math]::Round($drive.Used / 1GB, 1)
        $totalGB = [math]::Round(($drive.Used + $drive.Free) / 1GB, 1)
        $pct     = if ($totalGB -gt 0) { [math]::Round($drive.Used / ($drive.Used + $drive.Free) * 100) } else { 0 }
        Write-Info "Disk usage before export: ${usedGB}GB / ${totalGB}GB (${pct}%)"
    } catch {}
    Write-Host ""

    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $absOut = (Resolve-Path $outDir).Path

    $volumes = @(
        @{ Vol = "zeek-logs";     Label = "Zeek network logs"  },
        @{ Vol = "suricata-logs"; Label = "Suricata IDS logs"  },
        @{ Vol = "wazuh-logs";    Label = "Wazuh agent logs"   }
    )

    foreach ($v in $volumes) {
        Write-Info "  Exporting $($v.Label)..."
        $shellCmd = "cd /srcdata && find . -type f -mtime +$Days > /tmp/fl.txt 2>/dev/null; if [ -s /tmp/fl.txt ]; then tar czf /destdata/$($v.Vol).tar.gz -T /tmp/fl.txt 2>/dev/null && echo '    Archived files'; else echo '    No files older than $Days days in $($v.Vol)'; fi"
        docker run --rm `
            -v "$($v.Vol):/srcdata:ro" `
            -v "${absOut}:/destdata" `
            alpine sh -c $shellCmd
    }

    Write-Info "  Exporting portal database..."
    docker exec soc-portal sh -c "cp /app/data/soc.db /tmp/portal-db.bak 2>/dev/null && echo '    DB copied'" 2>$null
    docker cp "soc-portal:/tmp/portal-db.bak" "$absOut\portal-db.bak" 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Warn "Portal DB export skipped (container may not be running)" }

    Write-Host ""
    Write-Info "Creating archive..."
    $archivePath = "$outRoot\$outName.tar.gz"
    if (Get-Command tar -ErrorAction SilentlyContinue) {
        tar -czf $archivePath -C $outRoot $outName 2>$null
    } else {
        $archivePath = "$outRoot\$outName.zip"
        Compress-Archive -Path $outDir -DestinationPath $archivePath -Force
    }
    Remove-Item -Recurse -Force $outDir -ErrorAction SilentlyContinue

    $sz = if (Test-Path $archivePath) { [math]::Round((Get-Item $archivePath).Length / 1MB, 1) } else { "?" }
    Write-Ok "Archive: $archivePath  (${sz} MB)"
    Write-Host ""

    $purge = Read-Confirm "Purge exported data from containers to free disk space?"
    if ($purge) {
        Write-Host ""
        Write-Info "Purging old log files from volumes..."
        foreach ($v in $volumes) {
            docker run --rm -v "$($v.Vol):/data" alpine `
                sh -c "find /data -type f -mtime +$Days -delete 2>/dev/null && echo '    Purged $($v.Vol)'" 2>$null
        }
        Write-Ok "Old log files purged"
        Write-Host ""

        $prune = Read-Confirm "Run Docker system prune (removes build cache and unused images)?"
        if ($prune) {
            docker system prune -f 2>$null
            Write-Ok "Docker build cache cleared"
        }

        Write-Host ""
        try {
            $d2      = Get-PSDrive (Split-Path $PWD -Qualifier).TrimEnd(':') -ErrorAction Stop
            $used2   = [math]::Round($d2.Used / 1GB, 1)
            $total2  = [math]::Round(($d2.Used + $d2.Free) / 1GB, 1)
            $pct2    = if ($total2 -gt 0) { [math]::Round($d2.Used / ($d2.Used + $d2.Free) * 100) } else { 0 }
            Write-Info "Disk usage after cleanup: ${used2}GB / ${total2}GB (${pct2}%)"
        } catch {}
        Write-Host ""
    }

    Write-Warn "To transfer the archive, copy $archivePath to your backup destination."
}

function Manage-PacketCapture {
    param([string]$SubCommand = "status", [string]$Interface = "")
    switch ($SubCommand.ToLower()) {
        "start" {
            if (-not [string]::IsNullOrWhiteSpace($Interface)) {
                Update-EnvVar "SOC_NETWORK_INTERFACE" $Interface
                Write-Ok "Interface set to: $Interface"
            }
            Set-PacketCaptureEnabled $true
            Write-Info "Starting Zeek and Suricata..."
            docker compose up -d zeek suricata
            Write-Ok "Packet capture running"
        }
        "stop" {
            Set-PacketCaptureEnabled $false
            docker compose stop zeek suricata
            Write-Ok "Packet capture stopped"
        }
        "interface" {
            $newIface = $Interface
            if ([string]::IsNullOrWhiteSpace($newIface)) {
                $ifaces = Get-PhysicalInterfaces
                Write-Host "  Available interfaces:" -ForegroundColor DarkGray
                for ($i = 0; $i -lt $ifaces.Count; $i++) {
                    Write-Host "    $($i+1)) $($ifaces[$i])" -ForegroundColor Cyan
                }
                Write-Host ""
                $choice = Read-Input "Interface name or number" "1"
                $newIface = if ($choice -match '^\d+$') {
                    $idx = [int]$choice - 1
                    if ($idx -ge 0 -and $idx -lt $ifaces.Count) { $ifaces[$idx] } else { $ifaces[0] }
                } else { $choice }
            }
            Update-EnvVar "SOC_NETWORK_INTERFACE" $newIface
            Write-Ok "Interface set to: $newIface"
            Write-Warn "Restarting Zeek and Suricata to apply..."
            docker compose stop zeek suricata 2>$null
            docker compose up -d zeek suricata
            Write-Ok "Packet capture restarted on: $newIface"
        }
        "status" {
            Write-Host ""
            Write-Host "  Packet capture status:" -ForegroundColor White
            $enabled = "false"
            $iface   = "eth0"
            if (Test-Path ".env") {
                $e = (Get-Content ".env" | Where-Object { $_ -match "^ENABLE_PACKET_CAPTURE=" } | ForEach-Object { $_ -replace "^ENABLE_PACKET_CAPTURE=", "" } | Select-Object -First 1)
                $f = (Get-Content ".env" | Where-Object { $_ -match "^SOC_NETWORK_INTERFACE=" }  | ForEach-Object { $_ -replace "^SOC_NETWORK_INTERFACE=", ""  } | Select-Object -First 1)
                if (-not [string]::IsNullOrWhiteSpace($e)) { $enabled = $e }
                if (-not [string]::IsNullOrWhiteSpace($f)) { $iface   = $f }
            }
            Write-Info "Enabled: $enabled  |  Interface: $iface"
            Write-Host ""
            docker compose ps zeek suricata
        }
        default {
            Write-Err "Usage: .\setup.ps1 packet-capture [start [iface] | stop | interface [iface] | status]"
        }
    }
}

function Show-Usage {
    Write-Host ""
    Write-Host "  Usage:  .\setup.ps1 [command]" -ForegroundColor White
    Write-Host ""
    Write-Host "  Commands:" -ForegroundColor Yellow
    Write-Host "    start              Start platform (runs wizard if .env is missing)"
    Write-Host "    stop               Stop all containers"
    Write-Host "    restart            Restart all containers"
    Write-Host "    status             Show container status"
    Write-Host "    logs [service]     Stream logs (all, or a specific service)"
    Write-Host "    pull-model [name]              Download a different Ollama LLM model"
    Write-Host "    update                         Pull latest images and rebuild"
    Write-Host "    backup                         Archive configs + .env"
    Write-Host "    reconfigure                    Re-run the setup wizard"
    Write-Host "    reset-password                 Re-apply portal login password from .env"
    Write-Host "    disk-usage                     Show host and Docker volume disk usage"
    Write-Host "    export-data [days]             Compress + export logs older than N days"
    Write-Host "    packet-capture start [iface]   Enable Zeek+Suricata (Linux only)"
    Write-Host "    packet-capture stop             Disable Zeek+Suricata"
    Write-Host "    packet-capture interface [if]   Change listening interface"
    Write-Host "    packet-capture status           Show IDS container status"
    Write-Host ""
    Write-Host "  Example service names for logs:" -ForegroundColor DarkGray
    Write-Host "    soc-portal  soc-wazuh-manager  soc-wazuh-indexer" -ForegroundColor DarkGray
    Write-Host "    soc-grafana  soc-opencti  soc-velociraptor  soc-ollama" -ForegroundColor DarkGray
    Write-Host ""
}

# ── Entry point ───────────────────────────────────────────────────────
switch ($Command.ToLower()) {
    "start"       { Start-Platform }
    "stop"        { Stop-Platform }
    "restart"     { Restart-Platform }
    "status"      { Show-Status }
    "logs"        { Show-Logs $Arg }
    "pull-model"  { Pull-LlmModel $Arg }
    "update"      { Update-Platform }
    "backup"      { Backup-Platform }
    "reconfigure"     { Invoke-Reconfigure }
    "reset-password"  { Reset-PortalPassword }
    "disk-usage"      { Show-DiskUsage }
    "export-data"     { Export-SocData ([int]$(if ($Arg) { $Arg } else { 30 })) }
    "packet-capture"  { Manage-PacketCapture $Arg $Arg2 }
    { $_ -in "help", "--help", "-h" } { Show-Usage }
    default {
        Write-Err "Unknown command: $Command"
        Show-Usage
        exit 1
    }
}

# SOC Portal — Ubuntu Running Guide

A step-by-step operational guide for Ubuntu 22.04 / 24.04 LTS running in a **bridged-network VM**.  
Covers installation, full startup, first-run initialization, feature testing, and troubleshooting.

> **Bridged networking:** The VM gets its own IP on your LAN (e.g. `192.168.1.105`). Use that IP — not `localhost` — to access the portal from the host machine or any other device on the network.

> **Service configuration:** For detailed tuning of Prometheus, Zeek, Suricata, Wazuh, Grafana, Ollama, OpenCTI, Velociraptor, and Nginx, see [CONFIGURATION_GUIDE.md](CONFIGURATION_GUIDE.md).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Install Docker](#2-install-docker)
3. [Find Your VM's Bridged IP](#3-find-your-vms-bridged-ip)
4. [Clone the Repository](#4-clone-the-repository)
5. [Configure Environment](#5-configure-environment)
6. [Start the Stack](#6-start-the-stack)
7. [First-Run Initialization (Required Once)](#7-first-run-initialization-required-once)
8. [Verify All Services](#8-verify-all-services)
9. [Access the Web Interfaces](#9-access-the-web-interfaces)
10. [Feature Testing Walkthrough](#10-feature-testing-walkthrough)
11. [Enrol Wazuh Agents](#11-enrol-wazuh-agents)
12. [Start Optional Services (Zeek / Suricata / OpenCTI / Velociraptor)](#12-start-optional-services)
13. [Stop / Restart / Update](#13-stop--restart--update)
14. [Troubleshooting Reference](#14-troubleshooting-reference)

---

## 1. Prerequisites

| Requirement | Minimum | Check |
|-------------|---------|-------|
| Ubuntu | 22.04 or 24.04 LTS | `lsb_release -a` |
| CPU | 4 cores | `nproc` |
| RAM | 16 GB | `free -h` |
| Free disk | 30 GB | `df -h /` |
| Docker Engine | ≥ 24 | `docker --version` |
| Docker Compose | ≥ 2.20 | `docker compose version` |

> **Note:** On Ubuntu, Zeek and Suricata use `network_mode: host` and can monitor real network traffic — a key advantage over Windows.

---

## 2. Install Docker

Skip this section if Docker is already installed.

```bash
# Remove any old versions
sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null

# Install dependencies
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg lsb-release

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repo
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add your user to the docker group (avoids needing sudo for every docker command)
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker compose version
```

### Required kernel parameters

OpenSearch (Wazuh indexer) and OpenCTI's Elasticsearch both require a higher `vm.max_map_count`:

```bash
echo 'vm.max_map_count=262144' | sudo tee -a /etc/sysctl.conf
sudo sysctl -w vm.max_map_count=262144
```

Verify: `sysctl vm.max_map_count` should return `262144`.

---

## 3. Find Your VM's Bridged IP

Before configuring anything, note the IP your VM received from the network:

```bash
ip addr show | grep 'inet ' | grep -v '127.0.0.1'
# Example output:
#   inet 192.168.1.105/24 brd 192.168.1.255 scope global ens33
```

Note the IP (`192.168.1.105` in the example) and the interface name (`ens33`).  
You will use both in the next section. This IP is also how the host machine and other LAN devices reach the portal.

---

## 4. Clone the Repository

```bash
git clone https://github.com/Afa25/LLM-enabled-SOC-portal.git
cd LLM-enabled-SOC-portal/soc-portal
```

If you already have the files, navigate to the `soc-portal/` folder:

```bash
cd /path/to/LLM-enabled-SOC-portal/soc-portal
```

All commands in this guide assume you are in this directory.

---

## 5. Configure Environment

```bash
# Copy the example env file
cp .env.example .env

# Open and fill in your values
nano .env
```

**Set these two values first using the IP and interface from Section 3:**

```bash
SERVER_IP=192.168.1.105       # replace with your VM's bridged IP
SOC_NETWORK_INTERFACE=ens33   # replace with your interface name
```

**Full list of key variables:**

```
# Portal
PORTAL_USER=admin
PORTAL_PASS=ChangeThisPortalPassword1!
JWT_SECRET=<run: openssl rand -hex 32>

# Wazuh
WAZUH_API_PASSWORD=ChangeThisWazuhPassword1!
WAZUH_INDEXER_PASSWORD=ChangeThisIndexerPassword1!
WAZUH_DASHBOARD_PASSWORD=ChangeThisDashboardPassword1!

# Grafana
GRAFANA_PASSWORD=ChangeThisGrafanaPassword1!

# OpenCTI
OPENCTI_ADMIN_EMAIL=admin@soc.local
OPENCTI_ADMIN_PASSWORD=ChangeThisOpenCTI1!
OPENCTI_ADMIN_TOKEN=<run: python3 -c "import uuid; print(uuid.uuid4())">
OPENCTI_RABBITMQ_PASS=ChangeThisRabbitMQ1!
OPENCTI_MINIO_PASS=ChangeThisMinio1!

# Velociraptor
VELOCIRAPTOR_ADMIN_PASSWORD=ChangeThisVelo1!

# LLM — pinned model, <6 GB on disk
OLLAMA_MODEL=qwen2.5:7b-instruct-q4_K_M

# Network
SERVER_IP=192.168.1.105
SOC_NETWORK_INTERFACE=ens33
```

> **`SERVER_IP`** — the VM's bridged LAN IP. Pre-fills enrollment commands in **Agents → Add Agent** automatically.

> **`OLLAMA_MODEL`** — pinned to `qwen2.5:7b-instruct-q4_K_M` (~4.4 GB disk, ~5 GB RAM). Do not change to a larger model on 16 GB RAM.

> **`OPENCTI_ADMIN_TOKEN`** must be a valid UUID. Generate one:
> ```bash
> python3 -c "import uuid; print(uuid.uuid4())"
> ```

---

## 6. Start the Stack

### Core services (always start these first)

```bash
docker compose --env-file .env up -d \
  wazuh-indexer wazuh-manager wazuh-dashboard \
  grafana prometheus node-exporter \
  ollama soc-portal nginx
```

**First run only** — Docker downloads ~5 GB of images. Watch progress:

```bash
watch -n 3 docker compose ps
# Press Ctrl+C when all show "Up"
```

Wait until these statuses appear (takes 3–5 minutes):

```
NAME                   STATUS
soc-grafana            Up (healthy)
soc-nginx              Up
soc-node-exporter      Up
soc-ollama             Up (healthy)
soc-portal             Up (healthy)
soc-prometheus         Up
soc-wazuh-dashboard    Up
soc-wazuh-indexer      Up (healthy)
soc-wazuh-manager      Up
```

---

## 7. First-Run Initialization (Required Once)

> **This step is required exactly once** — after the first `docker compose up`.  
> On subsequent restarts, skip to Section 8.

### 7a. Initialize the OpenSearch Security Index

```bash
docker exec -u root soc-wazuh-indexer bash -c '
  chmod +x /usr/share/wazuh-indexer/plugins/opensearch-security/tools/securityadmin.sh
  export JAVA_HOME=/usr/share/wazuh-indexer/jdk
  /usr/share/wazuh-indexer/plugins/opensearch-security/tools/securityadmin.sh \
    -cd /usr/share/wazuh-indexer/opensearch-security \
    -icl -nhnv \
    -cacert /usr/share/wazuh-indexer/config/certs/root-ca.pem \
    -cert  /usr/share/wazuh-indexer/config/certs/indexer.pem \
    -key   /usr/share/wazuh-indexer/config/certs/indexer-key.pem \
    -h 127.0.0.1
'
```

**Expected output** (the `ERR` on the first line is a warning, not a failure):

```
ERR: Seems you use a node certificate which is also an admin certificate
   SUCC: Configuration for 'config' created or updated
   SUCC: Configuration for 'roles' created or updated
   SUCC: Configuration for 'rolesmapping' created or updated
   SUCC: Configuration for 'internalusers' created or updated
   ...
Done with success
```

### 7b. Set the Wazuh Admin Password

```bash
# Step 1 — generate a bcrypt hash of your WAZUH_API_PASSWORD
HASH=$(docker exec soc-portal node -e "
  const b = require('bcryptjs');
  console.log(b.hashSync('ChangeThisWazuhPassword1!', 12));
")
echo "Hash: $HASH"

# Step 2 — copy internal_users.yml out, patch hash, copy back
docker cp soc-wazuh-indexer:/usr/share/wazuh-indexer/opensearch-security/internal_users.yml /tmp/iu.yml

sed -i "s|\"\\\$2a\\\$12\\\$VcCDgh2NDk07JGN0rjGbM.Ad41qVR/YFJcgHp0UGns5JDymv..TOG\"|\"$HASH\"|" /tmp/iu.yml 2>/dev/null || \
  echo "Edit /tmp/iu.yml manually — find the admin: block and replace its hash: line"

docker cp /tmp/iu.yml soc-wazuh-indexer:/usr/share/wazuh-indexer/opensearch-security/internal_users.yml

# Step 3 — reload internalusers config
docker exec -u root soc-wazuh-indexer bash -c '
  export JAVA_HOME=/usr/share/wazuh-indexer/jdk
  chmod +x /usr/share/wazuh-indexer/plugins/opensearch-security/tools/securityadmin.sh
  /usr/share/wazuh-indexer/plugins/opensearch-security/tools/securityadmin.sh \
    -f /usr/share/wazuh-indexer/opensearch-security/internal_users.yml \
    -t internalusers -icl -nhnv \
    -cacert /usr/share/wazuh-indexer/config/certs/root-ca.pem \
    -cert  /usr/share/wazuh-indexer/config/certs/indexer.pem \
    -key   /usr/share/wazuh-indexer/config/certs/indexer-key.pem \
    -h 127.0.0.1
'
```

Expected: `SUCC: Configuration for 'internalusers' created or updated` then `Done with success`.

### 7c. Restart Dependent Services

```bash
docker compose --env-file .env restart wazuh-manager wazuh-dashboard soc-portal
sleep 30
```

### 7d. Pull the LLM Model (runs once, ~5 min)

The stack uses a **pinned model** (`qwen2.5:7b-instruct-q4_K_M`, ~4.4 GB) and a **pinned Ollama image** (`0.4.7`) so disk usage stays fixed and nothing grows on restart.

```bash
docker compose --env-file .env up -d ollama-init
docker logs soc-ollama-init -f
# Done when you see: "Model ready."
```

---

## 8. Verify All Services

> Run these commands **on the VM itself** using `localhost`, or from any machine on the LAN using the VM's IP.

### Quick health check

```bash
# Portal API (HTTP redirects to HTTPS — use -L to follow)
curl -Lsk https://localhost/api/health
# Expected: {"ok":true,"ts":"..."}

# From the host machine or another LAN device
curl -sk https://192.168.1.105/api/health

# Grafana
curl -sk -o /dev/null -w "HTTP %{http_code}\n" https://localhost/grafana/
# Expected: HTTP 302
```

### Check all containers

```bash
docker compose ps
```

Expected states:

| Container | Expected status |
|-----------|----------------|
| `soc-wazuh-indexer` | Up (healthy) |
| `soc-wazuh-manager` | Up |
| `soc-wazuh-dashboard` | Up |
| `soc-grafana` | Up (healthy) |
| `soc-prometheus` | Up |
| `soc-node-exporter` | Up |
| `soc-ollama` | Up (healthy) |
| `soc-portal` | Up (healthy) |
| `soc-nginx` | Up |
| `soc-ollama-init` | Exit 0 (normal) |

### Test authenticated API

```bash
BASE=https://localhost

# 1 — Get a CAPTCHA challenge
curl -sk $BASE/api/auth/captcha
# Returns: {"id":"...","question":"What is X + Y?"}

# 2 — Login (replace CAPTCHA_ID and ANSWER)
curl -sk -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"ChangeThisPortalPassword1!","captchaId":"CAPTCHA_ID","captchaAnswer":ANSWER}'
# Returns: {"token":"eyJ..."}

# 3 — Call stats with token
curl -sk -H "Authorization: Bearer YOUR_TOKEN" $BASE/api/stats
```

---

## 9. Access the Web Interfaces

Use the **VM's bridged IP** from other machines on the LAN, or `localhost` from inside the VM.

| Interface | URL (from VM) | URL (from LAN) | Username | Password |
|-----------|--------------|----------------|----------|----------|
| **SOC Portal** | https://localhost | https://192.168.1.105 | `admin` | `PORTAL_PASS` from `.env` |
| **Grafana** | https://localhost/grafana | https://192.168.1.105/grafana | `admin` | `GRAFANA_PASSWORD` from `.env` |
| **Wazuh Dashboard** | https://localhost/wazuh | https://192.168.1.105/wazuh | `admin` | `WAZUH_API_PASSWORD` from `.env` |
| **OpenCTI** | https://localhost/opencti | https://192.168.1.105/opencti | `admin@soc.local` | `OPENCTI_ADMIN_PASSWORD` |
| **Velociraptor** | https://localhost:8889 | https://192.168.1.105:8889 | `admin` | `VELOCIRAPTOR_ADMIN_PASSWORD` |
| **Prometheus** | https://localhost/prometheus | https://192.168.1.105/prometheus | — | — |

> Replace `192.168.1.105` with your actual VM IP from Section 3.  
> The portal uses a self-signed TLS cert — click through the browser warning.  
> The portal login page shows a CAPTCHA (math question). Answer it to proceed.

---

## 10. Feature Testing Walkthrough

### 10.1 Dashboard

1. Open https://192.168.1.105 → login
2. **Dashboard** tab — KPI cards show total alerts, critical count, active agents
3. Alert timeline chart shows events by hour
4. Data is live from the Wazuh indexer

### 10.2 Alerts

1. Click **Alerts** in the sidebar
2. Filter by severity level (3–15) and date range
3. Each alert shows rule ID, description, agent, and timestamp

### 10.3 AI Triage

1. Click **AI Triage** in the sidebar
2. **Queue** tab — shows all Level 7+ alerts not yet analyzed
3. Click **Analyze** on any alert card
   - Returns: verdict (true_positive / false_positive / needs_review), confidence %, MITRE tactic, recommended action
4. Click **Analyze All** to process every queued alert sequentially
5. **Results** tab — shows all analyzed alerts with filter by verdict

> First analysis per session takes ~15–20 seconds (model warm-up). Subsequent ones are faster.

### 10.4 AI Chat

1. Click **AI Chat** in the sidebar
2. Type any security question — press **Enter** or click send
3. **Live SOC Context** toggle (top-right): ON feeds current alert data to the LLM
4. **Model selector** — switch between available Ollama models

### 10.5 Reports

1. Click **Reports** → **Generate Report**
2. Choose a timeframe (24h, 7d, 30d) → **Generate**
3. Sections: Executive Summary, Alert Breakdown, Top Affected Agents, Recommendations
4. Click **Download** to save as Markdown

### 10.6 Scheduler

1. Click **Scheduler** → **New Schedule**
2. Fill in name, cron expression, and timeframe
3. Click **Run Now** to trigger immediately

**Common cron expressions:**

| Schedule | Cron |
|----------|------|
| Every day at 8:00 AM | `0 8 * * *` |
| Every Monday at 9:00 AM | `0 9 * * 1` |
| Every 6 hours | `0 */6 * * *` |
| First of month at midnight | `0 0 1 * *` |

### 10.7 Agents

1. Click **Agents** in the sidebar
2. Click **Add Agent** — enrollment commands are pre-filled with your `SERVER_IP`
3. Select OS (Linux / Windows) and tool (Wazuh, Node Exporter, Zeek, Suricata, etc.)
4. Copy and run the commands on the target machine

---

## 11. Enrol Wazuh Agents

> Use `SERVER_IP` from your `.env` (the VM's bridged IP) as the manager address — not `127.0.0.1`.

### Option A — Enrol the Ubuntu VM itself (fastest)

```bash
MANAGER_IP=192.168.1.105   # replace with your SERVER_IP from .env

curl -so wazuh-agent.deb \
  https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.7.3-1_amd64.deb

sudo WAZUH_MANAGER="$MANAGER_IP" dpkg -i ./wazuh-agent.deb
sudo systemctl enable --now wazuh-agent
sudo systemctl status wazuh-agent
```

### Option B — Enrol a remote Linux endpoint

```bash
# Run this on the remote machine
MANAGER_IP=192.168.1.105   # the VM's bridged IP

curl -so wazuh-agent.deb \
  https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.7.3-1_amd64.deb

sudo WAZUH_MANAGER="$MANAGER_IP" dpkg -i ./wazuh-agent.deb
sudo systemctl enable --now wazuh-agent
```

### Verify agent connectivity

```bash
docker exec soc-wazuh-manager /var/ossec/bin/agent_control -l
# Should show the agent as "active"
```

---

## 12. Start Optional Services

> Start these after the core stack is stable. They are resource-intensive — start only what you need.

### Zeek (network traffic analysis)

```bash
docker compose --env-file .env up -d zeek
docker logs soc-zeek -f
```

Verify it is capturing:

```bash
docker exec soc-zeek tail -f /usr/local/zeek/logs/current/conn.log
# JSON lines should appear as traffic flows
```

### Suricata (IDS/IPS)

```bash
docker compose --env-file .env up -d suricata
docker logs soc-suricata -f
```

Trigger a test alert:

```bash
curl http://testmyids.com
# Check for an alert in eve.json
docker exec soc-suricata tail -f /var/log/suricata/eve.json
```

### OpenCTI (threat intelligence platform)

> OpenCTI requires ~2–3 GB RAM. On 16 GB, start it only when needed and stop Ollama first if under pressure.

```bash
docker compose --env-file .env up -d \
  opencti-redis opencti-rabbitmq opencti-minio opencti-elasticsearch opencti
```

First boot takes 3–5 minutes while OpenCTI initialises its database. Monitor:

```bash
docker logs soc-opencti -f
# Ready when you see: "GraphQL server ready"
```

Access: **https://192.168.1.105/opencti**  
Login: `OPENCTI_ADMIN_EMAIL` / `OPENCTI_ADMIN_PASSWORD` from `.env`

> **Important:** `OPENCTI_ADMIN_TOKEN` in `.env` must be a valid UUID before starting:
> ```bash
> python3 -c "import uuid; print(uuid.uuid4())"
> ```

### Velociraptor (endpoint visibility & DFIR)

```bash
docker compose --env-file .env up -d velociraptor
docker logs soc-velociraptor -f
# Ready when you see: "Listening on ..."
```

On first boot Velociraptor auto-generates its config and creates the admin user. This takes ~30 seconds.

Access: **https://192.168.1.105:8889** (direct port, Velociraptor's own TLS cert)  
Login: `admin` / `VELOCIRAPTOR_ADMIN_PASSWORD` from `.env`

To enrol an endpoint, download the client from the Velociraptor UI → **Clients → Add client**.

> Velociraptor also exposes port **8001** for agent connections — allow this through the firewall if enrolling remote endpoints:
> ```bash
> sudo ufw allow 8001/tcp
> ```

---

## 13. Stop / Restart / Update

### Stop all containers (preserves all data)

```bash
docker compose down
```

### Stop and delete all data (full wipe)

```bash
docker compose down -v   # WARNING: deletes all stored alerts, reports, DB, threat intel
```

### Restart a single service

```bash
docker compose --env-file .env restart soc-portal
docker compose --env-file .env restart wazuh-manager
```

### Rebuild portal after code changes

```bash
docker compose --env-file .env up -d --build soc-portal
docker compose --env-file .env restart nginx
```

### View live logs

```bash
docker compose logs -f soc-portal        # portal only
docker compose logs -f                   # all services
docker logs soc-wazuh-manager --tail 50  # wazuh manager
docker logs soc-velociraptor --tail 50   # velociraptor
docker logs soc-opencti --tail 50        # opencti
```

### Auto-start on boot (systemd)

```bash
sudo tee /etc/systemd/system/soc-portal.service > /dev/null <<EOF
[Unit]
Description=SOC Portal Stack
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/path/to/LLM-enabled-SOC-portal/soc-portal
ExecStart=/usr/bin/docker compose --env-file .env up -d wazuh-indexer wazuh-manager wazuh-dashboard grafana prometheus node-exporter ollama soc-portal nginx
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

# Update WorkingDirectory above, then enable
sudo systemctl daemon-reload
sudo systemctl enable soc-portal
sudo systemctl start soc-portal
```

---

## 14. Troubleshooting Reference

### "All services show Up but nothing works"

This is the most common issue after a fresh deploy. `docker compose ps` shows every container as `Up` but the portal shows no data, Wazuh returns errors, and the LLM doesn't respond. Work through each service below.

#### Step 1 — Run the deep health check

This tests each service functionally, not just whether the container is running:

```bash
BASE=https://localhost

echo "=== Portal API ===" && curl -sk $BASE/api/health
echo ""
echo "=== Wazuh Indexer (OpenSearch) ===" && \
  curl -sk -u admin:ChangeThisWazuhPassword1! \
  https://localhost:9200/_cluster/health 2>/dev/null || \
  docker exec soc-wazuh-indexer curl -sk -u admin:ChangeThisWazuhPassword1! \
  https://localhost:9200/_cluster/health
echo ""
echo "=== Wazuh Manager API ===" && \
  docker exec soc-wazuh-manager curl -sk -u wazuh-wui:ChangeThisWazuhPassword1! \
  https://localhost:55000/ | head -c 200
echo ""
echo "=== Ollama models ===" && \
  docker exec soc-ollama curl -s http://localhost:11434/api/tags | head -c 200
echo ""
echo "=== Grafana ===" && \
  docker exec soc-grafana curl -s http://localhost:3000/api/health
echo ""
echo "=== Prometheus ===" && \
  docker exec soc-prometheus curl -s http://localhost:9090/-/healthy
```

#### Step 2 — Fix Wazuh (most common root cause)

If `docker compose ps` shows `soc-wazuh-indexer` as `Up (healthy)` but the Stats API returns `Unauthorized` or `ECONNREFUSED`, the OpenSearch security index was never initialized.

```bash
# Check the actual error
docker logs soc-wazuh-manager --tail 20
docker logs soc-portal --tail 20

# Fix: run the first-run security init (Section 7a and 7b)
docker exec -u root soc-wazuh-indexer bash -c '
  export JAVA_HOME=/usr/share/wazuh-indexer/jdk
  /usr/share/wazuh-indexer/plugins/opensearch-security/tools/securityadmin.sh \
    -cd /usr/share/wazuh-indexer/opensearch-security \
    -icl -nhnv \
    -cacert /usr/share/wazuh-indexer/config/certs/root-ca.pem \
    -cert  /usr/share/wazuh-indexer/config/certs/indexer.pem \
    -key   /usr/share/wazuh-indexer/config/certs/indexer-key.pem \
    -h 127.0.0.1
'
docker compose --env-file .env restart wazuh-manager wazuh-dashboard soc-portal
```

#### Step 3 — Fix Ollama / LLM model missing

If AI Chat returns no models or triage fails:

```bash
# Check if model was pulled
docker exec soc-ollama ollama list

# If empty, re-run the puller
docker compose --env-file .env up -d ollama-init
docker logs soc-ollama-init -f
# Wait for: "Model ready."
```

#### Step 4 — Fix Grafana showing no data

Grafana is running but dashboards are blank or show "No data":

```bash
# Check datasource connectivity from inside Grafana
docker exec soc-grafana curl -sk \
  -u admin:ChangeThisGrafanaPassword1! \
  https://wazuh-indexer:9200/_cluster/health | head -c 200

# If it fails, the Wazuh cert or password is wrong
# Check Grafana datasource logs
docker logs soc-grafana --tail 30 | grep -i error
```

If the OpenSearch datasource shows "Bad Gateway", Wazuh indexer isn't ready yet — wait 2–3 more minutes and reload.

#### Step 5 — Fix Zeek / Suricata capturing nothing

Container shows `Up` but no logs are being written:

```bash
# Check if log files exist and are growing
docker exec soc-zeek ls -la /usr/local/zeek/logs/current/ 2>/dev/null || \
  echo "Zeek logs directory not found — interface may be wrong"

docker exec soc-suricata ls -la /var/log/suricata/ 2>/dev/null

# Check the interface name matches SOC_NETWORK_INTERFACE in .env
ip link show
# Compare with:
grep SOC_NETWORK_INTERFACE .env

# If wrong, update .env and restart
docker compose --env-file .env up -d zeek suricata
```

#### Step 6 — Fix OpenCTI still initializing

OpenCTI shows `Up` but the web UI returns 502 or a loading spinner that never resolves:

```bash
# Check initialization progress
docker logs soc-opencti --tail 30

# Check Elasticsearch (OpenCTI's backend) is healthy
docker exec soc-opencti-elasticsearch curl -s http://localhost:9200/_cluster/health

# OpenCTI first boot takes 3–5 min — wait and check again
watch -n 10 'docker logs soc-opencti --tail 5'
```

#### Step 7 — Fix Velociraptor not responding on :8889

```bash
# Check if config was generated
docker exec soc-velociraptor ls /velociraptor/

# Check startup logs
docker logs soc-velociraptor --tail 30

# If config generation failed, wipe and restart
docker compose stop velociraptor
docker volume rm soc-portal_velociraptor-data
docker compose --env-file .env up -d velociraptor
docker logs soc-velociraptor -f
```

#### Step 8 — Check resource exhaustion

If multiple services are crashing or restarting, the VM is likely out of memory:

```bash
# See memory per container
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"

# See system memory
free -h

# See OOM kills in kernel log
dmesg | grep -i "oom\|killed" | tail -20
```

If OOM kills are happening, reduce OpenSearch heap and stop optional services:

```bash
# Stop heavy optional services
docker compose stop opencti opencti-elasticsearch opencti-redis \
  opencti-rabbitmq opencti-minio velociraptor

# Then in docker-compose.yml reduce:
# OPENSEARCH_JAVA_OPTS: "-Xms256m -Xmx256m"
# ES_JAVA_OPTS: "-Xms256m -Xmx256m"

docker compose --env-file .env up -d wazuh-indexer
```

---

### Container won't start / keeps restarting

```bash
docker logs <container-name>
# e.g.:
docker logs soc-portal
docker logs soc-wazuh-indexer
docker logs soc-opencti
```

### Common issues and fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `soc-wazuh-indexer` or `soc-opencti-elasticsearch` OOM killed | `vm.max_map_count` too low | `sudo sysctl -w vm.max_map_count=262144` (see Section 2) |
| `soc-portal` exits with `SQLITE_CANTOPEN` | `/app/data` not writable | `docker compose build soc-portal` |
| `soc-nginx` exits with `host not found in upstream` | Upstream container not running | Start the missing container first |
| Stats API returns `"Unauthorized"` | OpenSearch security index not initialized | Run Section 7a then 7b |
| Chat models returns `[]` | LLM model not pulled | `docker compose up -d ollama-init` and wait |
| Wazuh Dashboard blank | Missing cert or env var | `docker logs soc-wazuh-dashboard` |
| `wazuh-manager` port 55000 not listening | Config error | `docker logs soc-wazuh-manager` |
| OpenCTI stuck at startup | Elasticsearch not ready | Wait 2–3 min; `docker logs soc-opencti-elasticsearch` |
| Velociraptor not reachable on `:8889` | Config generation still running | Wait 30–60s; `docker logs soc-velociraptor` |
| Permission denied on docker commands | User not in docker group | `sudo usermod -aG docker $USER && newgrp docker` |
| Port 80 / 443 already in use | Apache or system nginx running | See below |

### Port conflict (common on Ubuntu)

```bash
# Check what's using port 80 or 443
sudo ss -tlnp | grep -E ':80|:443'

# Stop Apache if running
sudo systemctl stop apache2 && sudo systemctl disable apache2

# Stop system nginx if running
sudo systemctl stop nginx && sudo systemctl disable nginx
```

### Out of memory — RAM saving tips

```bash
# 1. Reduce Wazuh/OpenSearch heap in docker-compose.yml:
#    OPENSEARCH_JAVA_OPTS: "-Xms256m -Xmx256m"

# 2. Stop services you are not actively using
docker compose stop opencti opencti-elasticsearch opencti-redis opencti-rabbitmq opencti-minio

# 3. Check what is using the most memory
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}" | sort -k2 -h
```

### Reset and re-initialize (nuclear option)

```bash
docker compose down -v --remove-orphans

docker compose --env-file .env up -d \
  wazuh-indexer wazuh-manager wazuh-dashboard \
  grafana prometheus node-exporter \
  ollama soc-portal nginx

# Wait 3–5 min, then run Section 7 (first-run initialization) again
```

### Firewall — allow access from other machines

```bash
sudo ufw allow 80/tcp    # HTTP (redirects to HTTPS)
sudo ufw allow 443/tcp   # HTTPS — portal, Grafana, Wazuh, OpenCTI
sudo ufw allow 8889/tcp  # Velociraptor GUI
sudo ufw allow 8001/tcp  # Velociraptor agent enrollment
sudo ufw allow 1514/tcp  # Wazuh agent
sudo ufw allow 1514/udp
sudo ufw allow 1515/tcp  # Wazuh enrollment
sudo ufw status
```

---

## Quick Reference — Ports

| Service | Port | Access |
|---------|------|--------|
| **SOC Portal + Grafana + Wazuh + OpenCTI** | `443` (HTTPS) | https://\<server-ip\> |
| **HTTP redirect** | `80` | Redirects to HTTPS |
| **Velociraptor GUI** | `8889` | https://\<server-ip\>:8889 |
| **Velociraptor agent** | `8001` | For agent connections |
| **Wazuh agent syslog** | `514/udp` | For log forwarding |
| **Wazuh agent enrollment** | `1514, 1515` | For agent registration |

---

## Stack Overview

| Service | Role | RAM (approx) |
|---------|------|-------------|
| Wazuh Indexer (OpenSearch) | SIEM data store | ~1–2 GB |
| Wazuh Manager | Log collection, rules engine | ~512 MB |
| Wazuh Dashboard | SIEM UI | ~512 MB |
| Grafana | Metrics dashboards | ~256 MB |
| Prometheus + Node Exporter | Metrics collection | ~128 MB |
| Ollama (`qwen2.5:7b`) | Local LLM | ~5 GB |
| SOC Portal | Main web app | ~256 MB |
| Nginx | Reverse proxy + TLS | ~64 MB |
| OpenCTI + deps *(optional)* | Threat intelligence | ~2–3 GB |
| Velociraptor *(optional)* | DFIR / endpoint visibility | ~256 MB |
| Zeek *(optional)* | Network traffic analysis | ~256 MB |
| Suricata *(optional)* | Network IDS/IPS | ~256 MB |

---

*Last verified: 2026-05-18 with Docker Engine 26.x, Docker Compose v2.27 on Ubuntu 22.04 LTS.*

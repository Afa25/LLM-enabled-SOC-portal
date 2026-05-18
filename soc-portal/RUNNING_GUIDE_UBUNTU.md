# SOC Portal — Ubuntu Running Guide

A step-by-step operational guide for Ubuntu 22.04 / 24.04 LTS running in a **bridged-network VM**.  
Covers installation, full startup, first-run initialization, feature testing, and troubleshooting.

> **Bridged networking:** The VM gets its own IP on your LAN (e.g. `192.168.1.105`). Use that IP — not `localhost` — to access the portal from the host machine or any other device on the network.

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
12. [Start Optional Services (Zeek / Suricata / OpenVAS)](#12-start-optional-services-zeek--suricata--openvas)
13. [Stop / Restart / Update](#13-stop--restart--update)
14. [Troubleshooting Reference](#14-troubleshooting-reference)

---

## 1. Prerequisites

| Requirement | Minimum | Check |
|-------------|---------|-------|
| Ubuntu | 22.04 or 24.04 LTS | `lsb_release -a` |
| CPU | 4 cores | `nproc` |
| RAM | 16 GB | `free -h` |
| Free disk | 20 GB | `df -h /` |
| Docker Engine | ≥ 24 | `docker --version` |
| Docker Compose | ≥ 2.20 | `docker compose version` |

> **Note:** On Ubuntu, Zeek, Suricata, and OpenVAS can use `network_mode: host` — this is a key advantage over Windows.

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

### Required kernel parameter for Wazuh/OpenSearch

OpenSearch requires a higher `vm.max_map_count`. Set it permanently:

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
You will use these in the next section. This IP is also how the host machine and other LAN devices reach the portal.

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

**Set these two values using the IP and interface from Section 3:**

```bash
# Replace 192.168.1.105 and ens33 with your actual values from Section 3
SERVER_IP=192.168.1.105
SOC_NETWORK_INTERFACE=ens33
```

Full list of key variables:

```
WAZUH_API_PASSWORD=SecurePassword1!
GRAFANA_PASSWORD=SocGrafana1!
JWT_SECRET=<random long string>
OLLAMA_HOST=http://ollama:11434
SERVER_IP=192.168.1.105       # VM's bridged IP — from Section 3
SOC_NETWORK_INTERFACE=ens33   # VM's network interface — from Section 3
```

> **`SERVER_IP`** — the VM's bridged LAN IP. This is the address other machines use to reach the portal, and it pre-fills enrollment commands in **Agents → Add Agent** automatically.

> **`SOC_NETWORK_INTERFACE`** — the interface Zeek and Suricata will monitor inside Docker.

> Leave `OLLAMA_HOST` as `http://ollama:11434` — this is the Docker internal hostname.

---

## 6. Start the Stack

### Core services (always start these first)

```bash
docker compose --env-file .env up -d \
  wazuh-indexer wazuh-manager wazuh-dashboard \
  grafana prometheus node-exporter \
  ollama soc-portal nginx
```

**First run only** — Docker downloads ~4 GB of images. Track progress:

```bash
docker compose ps
```

Wait until these statuses appear (takes 3–5 minutes):

```
NAME                 STATUS
soc-grafana          Up (healthy)
soc-nginx            Up
soc-node-exporter    Up
soc-ollama           Up (healthy)
soc-portal           Up (healthy)
soc-prometheus       Up
soc-wazuh-dashboard  Up
soc-wazuh-indexer    Up (healthy)
soc-wazuh-manager    Up
```

Watch live status until all containers are up:

```bash
watch -n 3 docker compose ps
# Press Ctrl+C when all show "Up"
```

---

## 7. First-Run Initialization (Required Once)

> **This step is required exactly once** — after the first `docker compose up`.  
> It initializes the OpenSearch security index so Wazuh authentication works.  
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

### 7b. Set the Admin Password

```bash
# Step 1 — generate a bcrypt hash of your password
HASH=$(docker exec soc-portal node -e "
  const b = require('bcryptjs');
  console.log(b.hashSync('SecurePassword1!', 12));
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

### 7d. Pull the LLM Model (runs once, takes 2–5 min)

The stack uses a **pinned model** (`llama3.2:3b`, ~2 GB) and a **pinned Ollama image** (`0.4.7`) so disk usage stays fixed and nothing grows on restart.

```bash
docker compose --env-file .env up -d ollama-init
docker logs soc-ollama-init -f
# Done when you see: "Model ready."
```

---

## 8. Verify All Services

> Run these commands **on the VM itself** using `localhost`, or from any machine on the LAN using the VM's IP (e.g. `192.168.1.105`).

### Quick health check

```bash
# From the VM — use localhost
curl http://localhost/api/health
# Expected: {"ok":true,"ts":"..."}

# From the host machine or another LAN device — use the VM's bridged IP
curl http://192.168.1.105/api/health

# Grafana
curl -o /dev/null -w "HTTP %{http_code}\n" http://localhost/grafana/
# Expected: HTTP 301 (redirect to login)
```

### Check all containers

```bash
docker compose ps
```

All services should be `Up` or `Up (healthy)`. The only `Exit 0` is `soc-ollama-init` — that is normal.

### Test authenticated API

```bash
# Replace localhost with the VM's bridged IP if testing from another machine
BASE=http://localhost

# 1 — Get a CAPTCHA challenge
curl $BASE/api/auth/captcha
# Returns: {"id":"...","question":"What is X + Y?"}

# 2 — Login (replace CAPTCHA_ID and ANSWER with real values from step 1)
curl -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"SocPortal1!","captchaId":"CAPTCHA_ID","captchaAnswer":ANSWER}'
# Returns: {"token":"eyJ...","user":{"username":"admin","role":"admin"}}

# 3 — Use token to call stats
curl -H "Authorization: Bearer YOUR_TOKEN" $BASE/api/stats
# Returns JSON with alert counts, agent count, manager info
```

---

## 9. Access the Web Interfaces

Since the VM uses bridged networking, use the **VM's IP** (from Section 3) from any machine on the LAN, or `localhost` from inside the VM.

| Interface | From the VM | From host / other LAN device |
|-----------|------------|------------------------------|
| **SOC Portal** | http://localhost | http://192.168.1.105 |
| **Grafana** | http://localhost/grafana | http://192.168.1.105/grafana |
| **Wazuh Dashboard** | http://localhost/wazuh | http://192.168.1.105/wazuh |

**Credentials:**

| Interface | Username | Password |
|-----------|----------|----------|
| **SOC Portal** | `admin` | `` |
| **Grafana** | `admin` | `SocGrafana1!` |
| **Wazuh Dashboard** | `admin` | `SecurePassword1!` |

> Replace `192.168.1.105` with your actual VM IP from Section 3.  
> The portal login page shows a CAPTCHA (math question). Answer it to proceed.

---

## 10. Feature Testing Walkthrough

### 10.1 Dashboard

1. Open http://192.168.1.105 (or `localhost` from inside the VM) → login
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

---

## 11. Enrol Wazuh Agents

> The Wazuh manager listens on the VM's bridged IP. Use `SERVER_IP` from your `.env` (e.g. `192.168.1.105`) as the manager address for all agents — including the VM itself.

### Option A — Enrol the Ubuntu VM itself (fastest)

```bash
# Use the VM's own bridged IP so the agent registers correctly on the network
MANAGER_IP=192.168.1.105   # replace with your SERVER_IP from .env

curl -so wazuh-agent.deb \
  https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.7.3-1_amd64.deb

sudo WAZUH_MANAGER="$MANAGER_IP" dpkg -i ./wazuh-agent.deb
sudo systemctl enable --now wazuh-agent

# Check agent status
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

### Verify agent connectivity (from the SOC server)

```bash
docker exec soc-wazuh-manager /var/ossec/bin/agent_control -l
# Should show the agent as "active"
```

---

## 12. Start Optional Services (Zeek / Suricata / OpenVAS)

> On Ubuntu, `network_mode: host` works natively — unlike Windows. These services can monitor real traffic.

### Zeek (network traffic analysis)

```bash
docker compose --env-file .env up -d zeek
docker logs soc-zeek -f
```

Zeek listens on the host network interface. Set the correct interface in `docker-compose.yml`:

```yaml
environment:
  - ZEEK_INTERFACE=eth0   # replace with your interface (ip link show)
```

### Suricata (IDS/IPS)

```bash
docker compose --env-file .env up -d suricata
docker logs soc-suricata -f
```

Set the interface in `docker-compose.yml` the same way as Zeek.

### OpenVAS (vulnerability scanner)

> **Warning:** First boot takes 10–20 minutes for NVT feed sync. Do not interrupt it.

```bash
docker compose --env-file .env up -d openvas
# Monitor sync progress
docker logs soc-openvas -f
# Done when you see: "Synchronization of NVTs ... done"
```

OpenVAS web UI is available at http://localhost/openvas (admin / admin — change on first login).

---

## 13. Stop / Restart / Update

### Stop all containers (preserves data volumes)

```bash
docker compose down
```

### Stop and delete all data (full wipe)

```bash
docker compose down -v   # WARNING: deletes all stored alerts, reports, DB
```

### Restart a single service

```bash
docker compose --env-file .env restart soc-portal
docker compose --env-file .env restart wazuh-manager
```

### Full restart after code changes

```bash
docker compose --env-file .env up -d --build soc-portal
```

### View live logs

```bash
docker compose logs -f soc-portal        # portal only
docker compose logs -f                   # all services
docker logs soc-wazuh-manager --tail 50  # wazuh manager
```

### Auto-start on boot (systemd service)

To have the stack start automatically on boot:

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

# Update the WorkingDirectory path above, then enable
sudo systemctl daemon-reload
sudo systemctl enable soc-portal
sudo systemctl start soc-portal
```

---

## 14. Troubleshooting Reference

### Container won't start / keeps restarting

```bash
docker logs <container-name>
# e.g.:
docker logs soc-portal
docker logs soc-wazuh-indexer
```

### Common issues and fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `soc-wazuh-indexer` won't start, OOM killed | `vm.max_map_count` too low | `sudo sysctl -w vm.max_map_count=262144` (see Section 2) |
| `soc-portal` exits with `SQLITE_CANTOPEN` | `/app/data` not writable | Rebuild: `docker compose build soc-portal` |
| `soc-nginx` exits with `host not found in upstream` | Upstream container not running | Start the missing container first |
| Stats API returns `"Unauthorized"` | OpenSearch security index not initialized | Run Section 6a then 6b |
| Stats API returns `"Unexpected token 'O'"` | OpenSearch returning HTML error | Security index not initialized — see above |
| Chat models returns `[]` | LLM model not pulled | Run `docker compose up -d ollama-init` and wait |
| Wazuh Dashboard blank / crash | Missing cert or env var | Check `docker logs soc-wazuh-dashboard` |
| `wazuh-manager` API port 55000 not listening | Config error in ossec.conf | Check `docker logs soc-wazuh-manager` |
| Permission denied on docker commands | User not in docker group | `sudo usermod -aG docker $USER && newgrp docker` |
| Port 80 already in use | Another service (Apache/nginx) on port 80 | `sudo ss -tlnp \| grep :80` then stop that service |

### Port 80 conflict (common on Ubuntu)

```bash
# Check what's using port 80
sudo ss -tlnp | grep :80

# Stop Apache if it's running
sudo systemctl stop apache2
sudo systemctl disable apache2

# Stop system nginx if running
sudo systemctl stop nginx
sudo systemctl disable nginx
```

### Reset and re-initialize (nuclear option)

```bash
# Stop and remove everything including volumes
docker compose down -v --remove-orphans

# Start fresh
docker compose --env-file .env up -d \
  wazuh-indexer wazuh-manager wazuh-dashboard \
  grafana prometheus node-exporter \
  ollama soc-portal nginx

# Wait 3-5 min, then run Section 6 (first-run initialization) again
```

### Check resource usage

```bash
docker stats --no-stream

# System-wide memory
free -h

# Disk usage by Docker
docker system df
```

If RAM is under pressure:

```bash
# In docker-compose.yml, reduce OpenSearch heap (e.g., from 512m to 256m):
# OPENSEARCH_JAVA_OPTS: "-Xms256m -Xmx256m"
```

### Firewall — allow access from other machines

```bash
# Allow HTTP (port 80)
sudo ufw allow 80/tcp

# Allow Wazuh agent enrollment ports
sudo ufw allow 1514/tcp
sudo ufw allow 1514/udp
sudo ufw allow 1515/tcp

# Check status
sudo ufw status
```

---

## Quick Reference — Ports

| Service | Port | Access |
|---------|------|--------|
| **SOC Portal + all UIs** | `80` | http://\<server-ip\> |
| **Wazuh Manager API** | `55000` | Internal only |
| **Wazuh Agent syslog** | `514/udp` | For log forwarding |
| **Wazuh Agent enrollment** | `1514, 1515` | For agent registration |

---

*Last verified: 2026-05-15 with Docker Engine 26.x, Docker Compose v2.27 on Ubuntu 22.04 LTS.*

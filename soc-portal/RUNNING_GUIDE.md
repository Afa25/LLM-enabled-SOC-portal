# SOC Portal — Running Guide

A step-by-step operational guide tested on Windows 11 with Docker Engine 29.x.  
Covers full startup, mandatory first-run initialization, feature testing, and troubleshooting.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Start the Stack](#2-start-the-stack)
3. [First-Run Initialization (Required Once)](#3-first-run-initialization-required-once)
4. [Verify All Services](#4-verify-all-services)
5. [Access the Web Interfaces](#5-access-the-web-interfaces)
6. [Feature Testing Walkthrough](#6-feature-testing-walkthrough)
7. [Enrol Wazuh Agents](#7-enrol-wazuh-agents)
8. [Stop / Restart / Update](#8-stop--restart--update)
9. [Troubleshooting Reference](#9-troubleshooting-reference)
10. [Running the Full Stack on Windows via WSL2 (Zeek + Suricata)](#10-running-the-full-stack-on-windows-via-wsl2-zeek--suricata)

---

## 1. Prerequisites

| Requirement | Check |
|-------------|-------|
| Docker Engine ≥ 24 | `docker --version` |
| Docker Compose ≥ 2.20 | `docker compose version` |
| RAM ≥ 16 GB | Task Manager → Performance |
| Free disk ≥ 20 GB | For images + volumes |

**Working directory for all commands:**
```bash
cd C:\Users\Hp\Desktop\LLM-enabled-SOC-portal\soc-portal
# or wherever your soc-portal/ folder lives
```

---

## 2. Start the Stack

### Pull images and start core services

> **Two setup paths:**
> - **This section (no WSL2)** — runs the core SOC stack. Zeek and Suricata are excluded because `network_mode: host` requires a Linux kernel, which bare Windows Docker Engine does not provide.
> - **[Section 10 — WSL2 full stack](#10-running-the-full-stack-on-windows-via-wsl2-zeek--suricata)** — runs everything including Zeek and Suricata by using a real Linux kernel via WSL2. Recommended if you need live network traffic analysis.
>
> OpenVAS is excluded from both paths due to its 10–20 min NVT feed sync on first boot — start it manually once the rest of the stack is stable.

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

---

## 3. First-Run Initialization (Required Once)

> **This step is required exactly once** — after the first `docker compose up`.  
> It initializes the OpenSearch security index so Wazuh authentication works.  
> On subsequent restarts, skip to Section 4.

### 3a. Initialize the OpenSearch Security Index

Run `securityadmin.sh` inside the wazuh-indexer container to create the security index:

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

**Expected output** (ERR on first line is a warning, not a failure):

```
ERR: Seems you use a node certificate which is also an admin certificate
   SUCC: Configuration for 'config' created or updated
   SUCC: Configuration for 'roles' created or updated
   SUCC: Configuration for 'rolesmapping' created or updated
   SUCC: Configuration for 'internalusers' created or updated
   ...
Done with success
```

### 3b. Set the Admin Password

The default security config uses password `admin`. Update it to match the `.env` password (`SecurePassword1!`):

```bash
# Step 1 — generate a bcrypt hash of your password using the portal container
HASH=$(docker exec soc-portal node -e "
  const b = require('bcryptjs');
  console.log(b.hashSync('SecurePassword1!', 12));
")
echo "Hash: $HASH"

# Step 2 — copy internal_users.yml out, patch hash, copy back
docker cp soc-wazuh-indexer:/usr/share/wazuh-indexer/opensearch-security/internal_users.yml /tmp/iu.yml

# Replace the default admin hash (the long $2a$12$VcCDgh... string) with your hash
# Use sed or any text editor — the hash is on the line right after "admin:"
sed -i "s|\"\\\$2a\\\$12\\\$VcCDgh2NDk07JGN0rjGbM.Ad41qVR/YFJcgHp0UGns5JDymv..TOG\"|\"$HASH\"|" /tmp/iu.yml 2>/dev/null || \
  echo "Edit /tmp/iu.yml manually — find the admin: block and replace its hash: line"

docker cp /tmp/iu.yml soc-wazuh-indexer:/usr/share/wazuh-indexer/opensearch-security/internal_users.yml

# Step 3 — reload only the internalusers config
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

### 3c. Restart Dependent Services

```bash
docker compose --env-file .env restart wazuh-manager wazuh-dashboard soc-portal
```

Wait ~30 seconds, then proceed to Section 4.

### 3d. Pull the LLM Model (runs once, takes 2–5 min)

```bash
docker compose --env-file .env up -d ollama-init
```

`ollama-init` exits automatically when the model is ready. Check progress:

```bash
docker logs soc-ollama-init -f
# Done when you see: "Model ready."
```

---

## 4. Verify All Services

### Quick health check

```bash
# Portal API
curl http://localhost/api/health
# Expected: {"ok":true,"ts":"..."}

# Portal main page
curl -o /dev/null -w "HTTP %{http_code}" http://localhost/
# Expected: HTTP 200

# Grafana
curl -o /dev/null -w "HTTP %{http_code}" http://localhost/grafana/
# Expected: HTTP 301 (redirect to login)
```

### Check all containers

```bash
docker compose ps
```

All services should be `Up` or `Up (healthy)`. The only `Exit 0` is `soc-ollama-init` — that is normal.

### Test authenticated API

```bash
# 1 — Get a CAPTCHA challenge
curl http://localhost/api/auth/captcha
# Returns: {"id":"...","question":"What is X + Y?"}

# 2 — Login (replace CAPTCHA_ID and ANSWER with real values from step 1)
curl -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"SocPortal1!","captchaId":"CAPTCHA_ID","captchaAnswer":ANSWER}'
# Returns: {"token":"eyJ...","user":{"username":"admin","role":"admin"}}

# 3 — Use token to call stats
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost/api/stats
# Returns JSON with alert counts, agent count, manager info
```

---

## 5. Access the Web Interfaces

| Interface | URL | Username | Password |
|-----------|-----|----------|----------|
| **SOC Portal** | http://localhost | `admin` | `` |
| **Grafana** | http://localhost/grafana | `admin` | `SocGrafana1!` |
| **Wazuh Dashboard** | http://localhost/wazuh | `admin` | `SecurePassword1!` |

> The portal login page shows a CAPTCHA (math question). Answer it to proceed.

---

## 6. Feature Testing Walkthrough

### 6.1 Dashboard

1. Open http://localhost → login
2. **Dashboard** tab — KPI cards show total alerts, critical count, active agents
3. Alert timeline chart shows events by hour
4. Data is live from the Wazuh indexer

### 6.2 Alerts

1. Click **Alerts** in the sidebar
2. Filter by severity level (3–15) and date range
3. Each alert shows rule ID, description, agent, and timestamp
4. Sort by level or time

### 6.3 AI Triage

1. Click **AI Triage** in the sidebar
2. **Queue** tab — shows all Level 7+ alerts not yet analyzed
3. Click **Analyze** on any alert card
   - The LLM reads the alert + correlated events from the same agent (±5 min)
   - Returns: verdict (true_positive / false_positive / needs_review), confidence %, MITRE tactic, recommended action
4. Click **Analyze All** to process every queued alert sequentially
5. **Results** tab — shows all analyzed alerts with filter by verdict
6. Analyst actions:
   - Click **Confirm** to mark a true positive as confirmed
   - Click **Dismiss** to mark as investigated/closed
   - Add an optional note before confirming/dismissing

> **Note:** First analysis per session takes ~10 seconds (model cold start). Subsequent ones are faster.

### 6.4 AI Chat

1. Click **AI Chat** in the sidebar
2. Type any security question in the text box — press **Enter** or click send
3. The LLM streams responses token by token (live)
4. **Suggestions** — click any pre-built prompt card on the empty state screen
5. **Live SOC Context** toggle (top-right):
   - **ON (green)** — the LLM receives your last 24h alert counts, agent list, and critical events before answering
   - **OFF** — general security knowledge only
6. **Model selector** — click the settings icon to switch between available Ollama models
7. Chat history persists within the session; refresh to start a new conversation
8. Press **Escape** or send a new message to cancel a streaming response

**Suggested test prompts:**
```
What does a lateral movement attack look like in Wazuh alerts?
Explain MITRE ATT&CK tactic T1110 and how to detect it.
What are the top 5 things I should check in my SOC dashboard daily?
I see repeated SSH failures from 192.168.1.50 — what should I do?
```

### 6.5 Reports

1. Click **Reports** in the sidebar
2. Click **Generate Report**
3. Choose a timeframe (last 24h, 7d, 30d)
4. Click **Generate** — a streaming SSE response builds the report in real time
5. Report sections: Executive Summary, Alert Breakdown, Top Affected Agents, Recommendations
6. Click **Download** to save as Markdown, or copy the text

### 6.6 Scheduler

1. Click **Scheduler** in the sidebar
2. Click **New Schedule**
3. Fill in:
   - **Name** — e.g., `Daily Morning Report`
   - **Cron expression** — e.g., `0 8 * * *` (every day at 08:00)
   - **Timeframe** — data window for the report
4. Click **Save** — schedule appears in the list
5. Click **Run Now** to trigger immediately
6. Toggle the switch to pause/resume a schedule
7. Delete removes the schedule permanently

**Common cron expressions:**

| Schedule | Cron |
|----------|------|
| Every day at 8:00 AM | `0 8 * * *` |
| Every Monday at 9:00 AM | `0 9 * * 1` |
| Every 6 hours | `0 */6 * * *` |
| First of month at midnight | `0 0 1 * *` |

### 6.7 Agents

1. Click **Agents** in the sidebar
2. Shows all enrolled Wazuh agents with status, OS, last seen
3. Click any agent to view its details and recent alerts
4. Initially empty — enrol agents as described in Section 7

### 6.8 Devices

1. Click **Devices** in the sidebar
2. Register network devices for SNMP monitoring
3. Device health metrics collected every 5 minutes
4. QR code pairing available for mobile devices

---

## 7. Enrol Wazuh Agents

The portal shows the most data once at least one Wazuh agent is enrolled.

### Option A — Enrol the Windows host itself (fastest)

1. Open http://localhost/wazuh → login with `admin` / `SecurePassword1!`
2. Go to **Agents → Deploy new agent**
3. Select **Windows**, set manager IP to `127.0.0.1`
4. Copy the generated PowerShell command
5. Run it in **PowerShell as Administrator** on this machine
6. Within 30 seconds the agent appears as **Active** in the dashboard

### Option B — Enrol a Linux endpoint

```bash
# Run on the Linux endpoint (replace MANAGER_IP with your server's IP)
curl -so wazuh-agent.deb \
  https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.7.3-1_amd64.deb
sudo WAZUH_MANAGER='MANAGER_IP' dpkg -i ./wazuh-agent.deb
sudo systemctl enable --now wazuh-agent
```

### Verify agent connectivity

```bash
# From the server — should show agent as "active"
docker exec soc-wazuh-manager /var/ossec/bin/agent_control -l
```

---

## 8. Stop / Restart / Update

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
# --build forces a rebuild of the portal image
```

### View live logs

```bash
docker compose logs -f soc-portal        # portal only
docker compose logs -f                   # all services
docker logs soc-wazuh-manager --tail 50  # wazuh manager
```

---

## 9. Troubleshooting Reference

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
| `soc-portal` exits with `SQLITE_CANTOPEN` | `/app/data` not writable by `node` user | Already fixed in Dockerfile — rebuild: `docker compose build soc-portal` |
| `soc-nginx` exits with `host not found in upstream` | Upstream container not running or `openvas` not started | nginx now uses Docker DNS resolver with `set $upstream` — fixed in nginx.conf |
| `soc-wazuh-indexer` unhealthy forever | `curl` not in image — healthcheck fails | Already fixed to use `bash /dev/tcp` — check `docker inspect soc-wazuh-indexer` |
| Stats API returns `"Unauthorized"` | OpenSearch security index not initialized | Run Section 3a (securityadmin.sh) then Section 3b (set password) |
| Stats API returns `"Unexpected token 'O'"` | OpenSearch returning HTML error instead of JSON | Security index not initialized — see above |
| Chat models returns `[]` | LLM model not pulled yet | Run `docker compose up -d ollama-init` and wait |
| Wazuh Dashboard blank / crash | Missing `dashboard.pem` cert or env var | Already fixed — dashboard now uses HTTP on port 5601, no SSL |
| `wazuh-manager` API port 55000 not listening | Config error in ossec.conf blocks startup | Already fixed — removed `vulnerability-detection` block and Zeek rules |
| Wazuh rules error `'etc/shared/ar.conf'` | Missing file on first boot | `docker exec soc-wazuh-manager bash -c 'touch /var/ossec/etc/shared/ar.conf'` then restart |

### Reset and re-initialize (nuclear option)

If something is badly broken and you want to start completely fresh:

```bash
# Stop and remove everything including volumes
docker compose down -v --remove-orphans

# Start fresh
docker compose --env-file .env up -d \
  wazuh-indexer wazuh-manager wazuh-dashboard \
  grafana prometheus node-exporter \
  ollama soc-portal nginx

# Wait 3-5 min, then run Section 3 (first-run initialization) again
```

### Check resource usage

```bash
docker stats --no-stream
```

If RAM is under pressure, scale back:
- Reduce `OPENSEARCH_JAVA_OPTS` in docker-compose.yml (e.g., `-Xms256m -Xmx256m`)
- Skip `wazuh-dashboard` if you don't need the full Wazuh UI

---

## Quick Reference — Ports

| Service | Port | Access |
|---------|------|--------|
| **SOC Portal + all UIs** | `80` | http://localhost |
| **Wazuh Manager API** | `55000` | Internal only (portal connects via Docker network) |
| **Wazuh Agent syslog** | `514/udp` | For log forwarding |
| **Wazuh Agent enrollment** | `1514, 1515` | For agent registration |

---

*Last verified: 2026-04-15 with Docker Engine 29.4.0, Docker Compose v5.1.1 on Windows 11.*

---

## 10. Running the Full Stack on Windows via WSL2 (Zeek + Suricata)

**Why WSL2?**  
Zeek and Suricata use `network_mode: host` to capture raw network traffic. This requires a real Linux kernel — which bare Windows Docker Engine does not have. WSL2 provides a full Linux kernel inside Windows, making the complete stack work.

**What you gain:** live network traffic analysis (Zeek connection logs, Suricata IDS alerts) fed into Wazuh and the portal dashboard.

---

### Step 1 — Enable WSL2 and Install Ubuntu

Open **PowerShell as Administrator**:

```powershell
wsl --install -d Ubuntu-22.04
wsl --set-default-version 2
```

Restart your machine when prompted. After reboot, Ubuntu will finish installing and ask you to create a Linux username and password.

Verify WSL2 is active:

```powershell
wsl -l -v
# NAME            STATE    VERSION
# Ubuntu-22.04    Running  2       <-- must be VERSION 2
```

---

### Step 2 — Configure Docker for WSL2

**Option A — Docker Desktop (recommended for most users):**

1. Open **Docker Desktop** → **Settings** → **Resources** → **WSL Integration**
2. Enable integration for **Ubuntu-22.04**
3. Click **Apply & Restart**

After this, the `docker` and `docker compose` commands are available inside your WSL2 Ubuntu terminal automatically.

**Option B — Docker Engine directly inside WSL2 (no Docker Desktop):**

Run the following inside your Ubuntu WSL2 terminal:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
newgrp docker
sudo service docker start
```

Verify:
```bash
docker run --rm hello-world
```

---

### Step 3 — Fix `vm.max_map_count` for OpenSearch

OpenSearch (Wazuh Indexer) requires `vm.max_map_count ≥ 262144`. In WSL2, the `sysctl-init` container cannot set kernel parameters. You must set it on the WSL2 kernel directly.

**Persistent fix — edit `.wslconfig` in Windows:**

1. Open `%USERPROFILE%\.wslconfig` in Notepad (create it if it doesn't exist):
   ```
   C:\Users\<YourName>\.wslconfig
   ```
2. Add:
   ```ini
   [wsl2]
   kernelCommandLine = sysctl.vm.max_map_count=262144
   ```
3. Shut down WSL2 and restart it:
   ```powershell
   # In PowerShell
   wsl --shutdown
   ```
   Then reopen your Ubuntu terminal.

**Verify inside Ubuntu:**
```bash
sysctl vm.max_map_count
# Expected: vm.max_map_count = 262144
```

---

### Step 4 — Get the Project into WSL2

**Option A — Work from the Windows path directly (simpler, slower I/O):**
```bash
cd /mnt/c/Users/Golden/Desktop/LLM-enabled-SOC-portal/soc-portal
```
> File I/O across the `/mnt/c` boundary is slower. Fine for running the stack, but not ideal for active development.

**Option B — Copy into the WSL2 filesystem (recommended, faster I/O):**
```bash
cp -r /mnt/c/Users/Golden/Desktop/LLM-enabled-SOC-portal ~/LLM-enabled-SOC-portal
cd ~/LLM-enabled-SOC-portal/soc-portal
```

**Fix line endings on shell scripts (required if the repo was ever touched on Windows without `.gitattributes` enforcement):**
```bash
sudo apt-get install -y dos2unix
find . -name "*.sh" | xargs dos2unix
find . -name "filebeat-run" | xargs dos2unix
```

---

### Step 5 — Set the Network Interface

Zeek and Suricata need to know which interface to capture traffic on. Inside WSL2 the default interface is `eth0`.

Check yours:
```bash
ip link show
# Look for an interface named eth0 or similar
```

Edit your `.env` file and set:
```env
ZEEK_INTERFACE=eth0
```

> If you see `eth0` in `ip link show` but the name is different (e.g. `ens3`), use that name instead.

---

### Step 6 — Start the Full Stack

From inside your Ubuntu WSL2 terminal, run:

```bash
docker compose --env-file .env up -d \
  wazuh-indexer wazuh-manager wazuh-dashboard \
  grafana prometheus node-exporter \
  ollama soc-portal nginx \
  zeek suricata
```

Wait 3–5 minutes for all services to reach healthy status:

```bash
docker compose ps
```

Expected additional services now running:
```
NAME            STATUS
soc-zeek        Up
soc-suricata    Up
```

Then follow **Section 3 (First-Run Initialization)** exactly as documented — it is the same on WSL2.

---

### Step 7 — Access the Portal from Windows

With **Docker Desktop WSL2 integration**, ports are forwarded to Windows automatically:

| Interface | URL |
|-----------|-----|
| SOC Portal | http://localhost |
| Grafana | http://localhost/grafana |
| Wazuh Dashboard | http://localhost/wazuh |

With **Docker Engine inside WSL2 only** (Option B), use the WSL2 VM's IP instead of `localhost`:

```bash
# Get the WSL2 IP
ip addr show eth0 | grep 'inet ' | awk '{print $2}' | cut -d/ -f1
```

Then open `http://<that-ip>` in your Windows browser.

---

### Step 8 — Verify Zeek and Suricata Are Capturing

```bash
# Zeek — check connection logs are being written
docker exec soc-zeek ls -lh /pcap/logs/
# Or check the volume directly
docker logs soc-zeek --tail 20

# Suricata — check eve.json is being written
docker exec soc-suricata tail -n 5 /var/log/suricata/eve.json
docker logs soc-suricata --tail 20
```

In the SOC Portal dashboard, the **Network Analysis** section should now show Zeek connection summaries and Suricata IDS alert counts once traffic is flowing.

---

### WSL2 Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `vm.max_map_count` too low — Wazuh Indexer unhealthy | WSL2 kernel default is too low | Add `kernelCommandLine` to `.wslconfig`, run `wsl --shutdown`, restart |
| Zeek / Suricata containers exit immediately | Wrong interface name in `ZEEK_INTERFACE` | Run `ip link show` in WSL2 and update `.env` |
| `permission denied` on `.sh` scripts | CRLF line endings or missing execute bit | `find . -name "*.sh" \| xargs dos2unix && chmod +x scripts/*.sh` |
| `docker: command not found` in WSL2 | Docker Desktop WSL integration not enabled | Docker Desktop → Settings → WSL Integration → enable Ubuntu-22.04 |
| `localhost` not accessible from Windows browser | Using Docker Engine without Desktop port forwarding | Use the WSL2 VM IP (`ip addr show eth0`) |
| OpenSearch indexer stays unhealthy | `vm.max_map_count` not applied yet | Run `sysctl vm.max_map_count` inside WSL2 to confirm it's 262144 |
| Zeek logs empty after 5 minutes | Traffic not reaching `eth0` inside WSL2 | Try `ZEEK_INTERFACE=eth0` and generate traffic: `curl http://example.com` from inside WSL2 |

---

*Last verified: 2026-04-15 with Docker Engine 29.4.0, Docker Compose v5.1.1 on Windows 11.*

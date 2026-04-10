# 🛡️ SOC Portal — Open-Source Security Operations Center

A fully self-contained, Docker-based Security Operations Center built exclusively with free open-source tools.  
No licenses. No API keys. Runs on a single machine with one command.

---

## 📦 Stack

> [!TIP]
> **Optimized Build**: This stack uses advanced Docker multi-stage builds and Alpine-based images for a minimal footprint, faster startup, and improved security (non-root execution).

| Service | Role | URL |
|---------|------|-----|
| **SOC Portal** | Unified analyst dashboard | http://localhost |
| **Wazuh Manager** | SIEM + HIDS engine | — (internal) |
| **Wazuh Indexer** | OpenSearch log storage | — (internal) |
| **Wazuh Dashboard** | SIEM analyst UI | http://localhost/wazuh |
| **Grafana** | SOC performance dashboards | http://localhost/grafana |
| **Prometheus + Node Exporter** | Infrastructure metrics | — (internal) |
| **Zeek** | Network traffic analysis | — (internal) |
| **Suricata** | Network IDS/IPS | — (internal) |
| **OpenVAS** | Vulnerability scanner | http://localhost:9392 |
| **Ollama (llama3.2:3b)** | Local LLM — zero API cost | — (internal) |
| **Nginx** | Reverse proxy | port 80 |

---

## ⚙️ Requirements

| Item | Minimum | Recommended |
|------|---------|-------------|
| RAM | 16 GB | 32 GB |
| Disk | 50 GB free | 100 GB |
| CPU | 4 cores | 8 cores |
| OS | Windows 10/11 with WSL2, Ubuntu 22.04, macOS | Ubuntu 22.04 |
| Docker | ≥ 24.0 | latest |
| Docker Compose | ≥ 2.20 | latest |

---

## 🚀 How to Run — Step by Step

### Step 1 — Prerequisites

Make sure Docker Desktop is installed and running.  
Verify with:
```powershell
docker --version
docker compose version
```
Both commands must return without errors before continuing.

---

### Step 2 — Clone / Open the Project

```powershell
cd /path/to/soc-portal
```

---

### Step 3 — Configure Environment

The `.env` file is already present with working defaults.  
To customise passwords (recommended before any real deployment):

```powershell
notepad .env
```

Key variables to change for production:

```env
WAZUH_INDEXER_PASSWORD=YourStrongPassword1!
WAZUH_API_PASSWORD=YourStrongPassword2!
WAZUH_DASHBOARD_PASSWORD=YourStrongPassword3!
GRAFANA_PASSWORD=YourGrafanaPass1!
OPENVAS_PASSWORD=YourOpenVASPass1!
PORTAL_PASS=YourPortalPass1!
JWT_SECRET=<any long random string — already set>
SOC_NETWORK_INTERFACE=eth0   # change to your actual interface if needed
```

> For a lab/demo the defaults work fine as-is.

---

### Step 4 — TLS Certificates

Wazuh requires TLS certificates to start. They have already been generated into `configs/wazuh/certs/`.  
If you ever need to regenerate them (e.g. after a clean wipe):

```powershell
docker run --rm -v "${PWD}/configs/wazuh/certs:/certs" --entrypoint sh alpine/openssl -c "
  openssl genrsa -out /certs/root-ca-key.pem 2048 2>/dev/null &&
  openssl req -new -x509 -days 3650 -key /certs/root-ca-key.pem -out /certs/root-ca.pem -subj /CN=wazuh-root-ca/O=SOC 2>/dev/null &&
  openssl genrsa -out /certs/filebeat-key.pem 2048 2>/dev/null &&
  openssl req -new -key /certs/filebeat-key.pem -out /certs/filebeat.csr -subj /CN=wazuh-manager/O=SOC 2>/dev/null &&
  openssl x509 -req -days 3650 -in /certs/filebeat.csr -CA /certs/root-ca.pem -CAkey /certs/root-ca-key.pem -CAcreateserial -out /certs/filebeat.pem 2>/dev/null &&
  openssl genrsa -out /certs/indexer-key.pem 2048 2>/dev/null &&
  openssl req -new -key /certs/indexer-key.pem -out /certs/indexer.csr -subj /CN=wazuh-indexer/O=SOC 2>/dev/null &&
  openssl x509 -req -days 3650 -in /certs/indexer.csr -CA /certs/root-ca.pem -CAkey /certs/root-ca-key.pem -CAcreateserial -out /certs/indexer.pem 2>/dev/null &&
  echo CERTS_OK"
```

---

### Step 5 — Start the Stack

```powershell
docker compose up -d --build
```

**First run** downloads and builds images. Thanks to **multi-stage optimization** and layer caching, subsequent builds and startups are extremely fast (< 30s).  
Allow 5–10 minutes for the initial pull of massive components like the Wazuh Indexer and OpenVAS.

Watch startup progress:
```powershell
docker compose ps
```

Wait until you see all containers as `Up` or `Up (healthy)`:
```
soc-wazuh-indexer    Up (healthy)
soc-wazuh-manager    Up
soc-wazuh-dashboard  Up
soc-grafana          Up (healthy)
soc-ollama           Up (healthy)
soc-ollama-init      Exit 0          ← normal, runs once then exits
soc-openvas          Up
soc-portal           Up
soc-nginx            Up
soc-prometheus       Up
soc-node-exporter    Up
soc-zeek             Up
soc-suricata         Up
```

> `soc-ollama-init` showing `Exit 0` is **normal** — it pulls the LLM model once then stops.

---

### Step 6 — Verify Everything is Up

Run these quick checks:

```powershell
# SOC Portal health
curl http://localhost/api/health
# Expected: {"ok":true,"ts":"..."}

# Wazuh Indexer
curl -k -u admin:SecurePassword1! https://localhost:9200
# Expected: JSON with cluster_name

# Ollama model ready
curl http://localhost:11434/api/tags
# Expected: {"models":[{"name":"llama3.2:3b",...}]}

# Grafana
curl http://localhost/grafana/api/health
# Expected: {"commit":"...","database":"ok",...}
```

---

## 🔐 Default Logins

| Service | URL | Username | Password |
|---------|-----|----------|----------|
| **SOC Portal** | http://localhost | `admin` | `SocPortal1!` |
| **Grafana** | http://localhost/grafana | `admin` | `SocGrafana1!` |
| **Wazuh Dashboard** | http://localhost/wazuh | `admin` | `SecurePassword1!` |
| **OpenVAS** | http://localhost:9392 | `admin` | `SecureOpenVAS1!` |

> All passwords are set in `.env`. If you changed them, use your values.

---

## 🖥️ Testing Each UI

### SOC Portal — http://localhost
1. Login with `admin` / `SocPortal1!`
2. **Dashboard** — shows KPI cards, alert timeline, agent status
3. **Alerts** — live Wazuh alerts with severity filter and date range
4. **Agents** — all enrolled Wazuh endpoints
5. **Reports** → click **Generate Report** → choose timeframe → click **Generate**  
   *(takes 1–3 min — Ollama runs locally, no internet needed)*
6. **Scheduler** → click **New Schedule** → set daily/weekly/monthly automation

### Wazuh Dashboard — http://localhost/wazuh
1. Login with `admin` / `SecurePassword1!`
2. Check **Security Events**, **Agents**, **Vulnerabilities**
3. Empty until agents are enrolled — see Step 7 below

### Grafana — http://localhost/grafana
1. Login with `admin` / `SocGrafana1!`
2. Go to **Dashboards** → open **SOC Dashboard**
3. Panels show live data once agents are sending events

### OpenVAS — http://localhost:9392
1. Login with `admin` / `SecureOpenVAS1!`
2. **First run only:** wait 10–20 min for NVT feed sync
3. Go to **Scans → Tasks** → **New Task** to run a vulnerability scan

---

## 📡 Step 7 — Enrol Endpoints (Get Real Data)

The portal shows real alerts only after at least one Wazuh agent is enrolled.

### Enrol the Windows host itself (quickest test)

1. Open Wazuh Dashboard → http://localhost/wazuh
2. Go to **Agents → Deploy new agent**
3. Select **Windows**, set server address to `127.0.0.1`
4. Copy the PowerShell command it generates
5. Run it in PowerShell **as Administrator** on the Windows machine
6. Within 30 seconds the agent appears as **Active** and alerts start flowing

### Enrol a Linux machine

```bash
# Run on the Linux endpoint — replace MANAGER_IP with your server's IP
curl -so wazuh-agent.deb https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.7.3-1_amd64.deb
sudo WAZUH_MANAGER='MANAGER_IP' dpkg -i ./wazuh-agent.deb
sudo systemctl enable --now wazuh-agent
```

### Enrol via the helper script

```bash
bash scripts/enroll-agent.sh linux    # prints Linux install command
bash scripts/enroll-agent.sh windows  # prints Windows install command
bash scripts/enroll-agent.sh macos    # prints macOS install command
```

---

## 🤖 AI Reports — Local LLM, No API Key

Reports are generated by **Ollama** running entirely inside Docker.  
No data leaves your machine.

**Default model:** `llama3.2:3b` (2 GB, fast, good quality)

**Upgrade to a better model:**
```powershell
# Pull a better model (Ollama must be running)
docker exec soc-ollama ollama pull mistral:7b     # 4 GB, better quality
docker exec soc-ollama ollama pull llama3.1:8b    # 5 GB, best quality
docker exec soc-ollama ollama pull phi3:mini      # 2 GB, very fast

# Then update .env and restart the portal
# Edit .env: OLLAMA_MODEL=mistral:7b
docker compose restart soc-portal
```

**Generate a report manually:**  
SOC Portal → Reports → Generate Report → choose timeframe → Generate

**Automate reports:**  
SOC Portal → Scheduler → New Schedule → set daily / weekly / monthly / custom cron

---

## 🔧 Management Commands

```powershell
# Start everything
docker compose up -d --build

# Stop everything (keeps data)
docker compose down

# Stop and wipe all data (full reset)
docker compose down -v

# Restart a single service
docker compose restart soc-portal
docker compose restart soc-wazuh-manager

# View logs
docker compose logs -f                        # all services
docker compose logs -f soc-portal             # portal only
docker compose logs -f soc-wazuh-indexer      # indexer only
docker compose logs --tail=50 soc-ollama      # last 50 lines

# Check container status
docker compose ps

# Reload Wazuh detection rules (after editing local_rules.xml)
docker exec soc-wazuh-manager /var/ossec/bin/wazuh-control reload
```

---

## 🛠️ Troubleshooting

### Docker storage corruption (I/O error on startup)
```
input/output error: unknown
```
1. Right-click Docker whale in system tray → **Quit Docker Desktop**
2. Reopen Docker Desktop → wait for green "Engine running"
3. If still broken: Docker Desktop → Settings → Troubleshoot → **Clean / Purge data**
4. Re-run `docker compose up -d --build`

### Wazuh indexer stays unhealthy
```powershell
docker logs soc-wazuh-indexer --tail 30
```
Usually needs more time (up to 2 min). If it keeps failing, increase Docker Desktop memory to at least 8 GB:  
Docker Desktop → Settings → Resources → Memory → 8 GB+

### Portal shows "No data" / zeros on dashboard
Normal until a Wazuh agent is enrolled. See Step 7.

### OpenVAS login fails
It takes 10–20 min on first run to sync the NVT vulnerability feed.  
Check progress: `docker logs soc-openvas --tail 20`

### Ollama report generation times out
The LLM model may still be downloading. Check:  
`docker logs soc-ollama-init -f`  
Wait for `Model ready.` before generating reports.

### Port 80 already in use
```powershell
# Find what's using port 80
netstat -ano | findstr :80
# Kill it or change the nginx port in docker-compose.yml:
# ports: - "8080:80"
# Then access the portal at http://localhost:8080
```

### 502 Bad Gateway on /wazuh
Wazuh Dashboard takes 2–3 min to start after the indexer is healthy.  
Wait and refresh. Check: `docker logs soc-wazuh-dashboard --tail 20`

---

## 🔒 Custom Detection Rules

Edit `configs/wazuh/manager/local_rules.xml` to add or modify detection rules.

Pre-configured ATT&CK coverage:

| Rule | Technique | Description |
|------|-----------|-------------|
| 100200 | T1110.001 | SSH Brute-Force (auto-blocks IP) |
| 100201 | T1190 | Web SQL Injection |
| 100202 | T1548.003 | Privilege Escalation via sudo |
| 100203 | T1550.002 | Pass-the-Hash / lsass access |
| 100204 | T1218 | LOLBin proxy execution |
| 100205 | T1071.004 | DNS Tunnelling |
| 100206 | T1048 | Data Exfiltration |
| 100207 | T1136.001 | Local account creation |
| 100208 | T1486 | File encryption (ransomware) |
| 100209 | T1059.001 | PowerShell obfuscation |

After editing rules, reload without restarting:
```powershell
docker exec soc-wazuh-manager /var/ossec/bin/wazuh-control reload
```

---

## 📁 Project Structure

```
soc-portal/
├── configs/
│   ├── grafana/provisioning/     # Auto-provisioned dashboards + datasources
│   ├── nginx/nginx.conf          # Reverse proxy config
│   ├── prometheus/prometheus.yml # Metrics scrape config
│   ├── suricata/suricata.yaml    # Network IDS config
│   ├── wazuh/
│   │   ├── certs/                # TLS certificates (auto-generated)
│   │   ├── manager/
│   │   │   ├── ossec.conf        # Wazuh manager config
│   │   │   └── local_rules.xml   # Custom ATT&CK detection rules
│   │   └── indexer/opensearch.yml
│   └── zeek/local.zeek           # Network analysis scripts
├── portal/
│   ├── client/src/               # React frontend (5 pages)
│   ├── server/                   # Node.js/Express backend
│   │   ├── routes/               # auth, alerts, agents, reports, schedule, stats
│   │   ├── services/             # wazuh.js, ollama.js, scheduler.js
│   │   └── db/database.js        # SQLite (users, reports, schedules, audit_log)
│   └── Dockerfile
├── scripts/
│   ├── enroll-agent.sh           # Agent enrolment helper
│   └── generate-certs.sh        # TLS cert generator
├── docker-compose.yml
├── .env                          # All passwords and config (do not commit)
└── .env.example                  # Template
```

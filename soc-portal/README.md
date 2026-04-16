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
4. **AI Triage** — AI-powered alert analysis (see full section below)
5. **Agents** — all enrolled Wazuh endpoints
6. **Reports** → click **Generate Report** → choose timeframe → click **Generate**  
   *(takes 1–3 min — Ollama runs locally, no internet needed)*
7. **Scheduler** → click **New Schedule** → set daily/weekly/monthly automation

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

## 💬 AI Chat — SOC Analyst Assistant

An interactive chat interface powered by your local Ollama LLM. Ask anything about threats, alerts, investigations, or MITRE techniques — all responses stay on your server.

### Key features

- **Live SOC context** — toggle on/off. When on, the AI is automatically given your current Wazuh alert counts, top categories, and busiest agent before answering, so responses are specific to your environment.
- **Token-by-token streaming** — responses appear word-by-word, just like ChatGPT, using SSE over a POST request.
- **Multi-turn conversation** — the full chat history is sent with each message so the AI remembers context.
- **Suggested prompts** — 6 pre-built SOC questions on the empty-state screen to get started fast.
- **Model switching** — pick any Ollama model from the settings panel.
- **Stateless** — conversations are not stored in the database; they clear on refresh for privacy.

### How to test AI Chat

1. Start the stack: `docker compose up -d`
2. Open the portal → http://localhost → login
3. Click **"AI Chat"** in the sidebar
4. Make sure the green **"Live context"** badge is on (top right)
5. Click any suggested prompt, or type your own question and press **Enter**
6. The response streams in token-by-token — no waiting for the full answer

#### Suggested test questions

```
What are the top threats I should focus on right now?
Explain MITRE T1190 and how to detect it in Wazuh.
Walk me through investigating a brute-force alert step by step.
How do I reduce false positives for sudo privilege escalation rules?
```

#### Toggle live context on/off

- **On** (default): the AI sees your current Wazuh alert summary and can answer questions like "what's happening now?"
- **Off**: pure general SOC knowledge, no live data injected — useful when Wazuh is not yet connected

#### Switch to a better model

```powershell
docker exec soc-ollama ollama pull mistral:7b
# Then open Settings panel in AI Chat → select mistral:7b
```

#### Troubleshooting chat

| Symptom | Fix |
|---------|-----|
| Spinner spins forever | Check `docker logs soc-ollama` — model may still be loading |
| "Error: Ollama returned 500" | Model not pulled — run `docker exec soc-ollama ollama pull llama3.2:3b` |
| Responses are truncated | Switch to a larger model (mistral:7b, llama3.1:8b) |
| "Live context" shows stale data | Normal — it fetches fresh data on every message send |

---

## 📅 Report Scheduler

Automatically generate AI security reports on a cron schedule — daily, weekly, monthly, or custom.

### How it works

The scheduler runs entirely server-side using `node-cron`. When a schedule fires, the portal:
1. Fetches fresh alert data from Wazuh for the configured timeframe
2. Sends it to the local Ollama LLM with the full SOC report prompt
3. Saves the completed report to the database automatically

Reports generated by the scheduler are identical to manual reports — they appear in the **Reports** page.

### How to test the Scheduler

1. Open the portal → click **"Scheduler"** in the sidebar
2. Click **"New Schedule"**
3. Fill in:
   - **Name**: e.g. `Daily Security Brief`
   - **Frequency**: Daily / Weekly / Monthly / Custom cron
   - **LLM Model**: pick from available Ollama models
4. Click **Create**
5. The schedule card appears — click **"Run Now"** to trigger it immediately (no waiting for the cron time)
6. After ~1–3 minutes, check the **Reports** page — the new report will appear there

### Schedule management

| Action | How |
|--------|-----|
| Pause a schedule | Click the toggle switch on the schedule card |
| Resume a schedule | Click the toggle switch again |
| Run immediately | Click **Run Now** on the card |
| Delete a schedule | Click the trash icon |
| Custom timing | Choose "Custom" frequency and enter a cron expression |

### Cron expression examples

```
0 7 * * *      → Every day at 07:00
0 8 * * 1      → Every Monday at 08:00
0 6 1 * *      → 1st of every month at 06:00
0 6 * * 1-5   → Weekdays only at 06:00
0 */6 * * *   → Every 6 hours
```

---

## 🧠 AI Alert Triage — Local LLM, No API Key

Automatically analyzes every high-severity alert (Level 7+) using the local Ollama LLM.
The AI reads the alert, fetches correlated events from the same agent in the ±5 minute window,
and returns a structured verdict — without sending any data outside your network.

### What you get per alert

| Field | Description |
|-------|-------------|
| **Verdict** | `True Positive` / `False Positive` / `Needs Review` |
| **Confidence** | 0–100% — how certain the model is |
| **Explanation** | 2–3 sentence reasoning in plain English |
| **MITRE ATT&CK** | Mapped technique if detected (e.g. `T1110 Brute Force`) |
| **Recommended Action** | Concrete next step for the analyst |

### How to test AI Triage

#### Prerequisites
- Stack is running (`docker compose up -d`)
- At least one Wazuh agent enrolled and generating alerts
- Ollama model is ready (`docker logs soc-ollama-init` shows `Model ready.`)

#### Step-by-step

1. **Open the portal** → http://localhost → login
2. **Click "AI Triage"** in the left sidebar
3. The **Queue** tab shows all unanalyzed alerts with severity ≥ 7
4. Click **"Analyze with AI"** on any alert card
   - The card shows a spinner while Ollama processes (~10–30 seconds per alert)
   - The AI verdict appears inline when complete
5. Review the verdict, explanation, and recommended action
6. Click **Confirm** (true threat) or **Dismiss** (false positive) to record your decision

#### Analyze everything at once

Click **"Analyze All"** (top right) to process the entire queue sequentially.
Progress shows as `3/12` while running. Each alert takes ~10–30 s depending on hardware.

#### Switch models for better accuracy

```powershell
# Pull a more capable model
docker exec soc-ollama ollama pull mistral:7b

# Set it as the triage model
# Edit .env: OLLAMA_MODEL=mistral:7b
docker compose restart soc-portal
```

Larger models (7B+) produce higher-quality verdicts with better MITRE mapping.
The default `llama3.2:3b` is optimized for speed on CPU-only hardware.

#### API testing (curl)

```bash
# 1. Login and get token
TOKEN=$(curl -s -X POST http://localhost/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"SocPortal1!","captchaId":"x","captchaAnswer":0}' \
  | jq -r .token)

# Note: get a real captchaId first:
CAPTCHA=$(curl -s http://localhost/api/auth/captcha)
echo $CAPTCHA   # {"id":"...","question":"What is 4 + 7?"}
# Then answer the question and re-run the login with real captchaId + captchaAnswer

# 2. Fetch the triage queue
curl -s http://localhost/api/triage/queue \
  -H "Authorization: Bearer $TOKEN" | jq '.[0]'

# 3. Analyze the first queued alert (paste the full alert JSON as body)
curl -s -X POST http://localhost/api/triage/analyze \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '<alert JSON from step 2>' | jq .

# 4. List all results
curl -s http://localhost/api/triage \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | {verdict, confidence, explanation}'

# 5. Confirm a result (replace 1 with actual id)
curl -s -X PATCH http://localhost/api/triage/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"analyst_status":"confirmed","analyst_note":"Verified brute force from external IP"}'
```

#### Generating test alerts (no real agent needed)

If you don't have a Wazuh agent yet, trigger synthetic alerts by hitting the manager directly:

```bash
# SSH brute-force simulation — generates Level 10 alerts in Wazuh
docker exec soc-wazuh-manager bash -c '
for i in $(seq 1 20); do
  echo "$(date +"%Y-%m-%dT%H:%M:%S") sshd[1234]: Failed password for root from 203.0.113.1 port 22 ssh2" \
    >> /var/ossec/logs/active-responses.log
done'

# Then open AI Triage — the queue should populate within 30 seconds
```

#### Troubleshooting triage

| Symptom | Cause | Fix |
|---------|-------|-----|
| Queue is empty | No high-severity alerts | Enrol a Wazuh agent or use synthetic alerts above |
| "Ollama 500" error | Model not loaded | Run `docker logs soc-ollama-init` — wait for `Model ready.` |
| Verdict is always "needs_review" | Model too small / bad parse | Switch to `mistral:7b` for better structured output |
| Analysis takes > 60 s | CPU-only inference | Normal on hardware without GPU — `llama3.2:3b` typically takes 15–45 s |
| Queue doesn't update | Wazuh indexer not ready | Wait 2–3 min after startup, then refresh |

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

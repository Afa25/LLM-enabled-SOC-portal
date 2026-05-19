# SOC Portal — Configuration Guide

How to configure, tune, and extend each service in the stack.  
All config files live under `soc-portal/configs/`. Changes take effect after restarting the relevant container.

---

## Table of Contents

1. [Prometheus](#1-prometheus)
2. [Zeek](#2-zeek)
3. [Suricata](#3-suricata)
4. [Wazuh](#4-wazuh)
5. [Grafana](#5-grafana)
6. [Ollama (LLM)](#6-ollama-llm)
7. [OpenCTI](#7-opencti)
8. [Velociraptor](#8-velociraptor)
9. [Nginx](#9-nginx)

---

## 1. Prometheus

**Config file:** `configs/prometheus/prometheus.yml`

### What it does
Scrapes metrics from Node Exporter, Grafana, the SOC portal health endpoint, and any enrolled endpoints. Grafana reads from it to display system dashboards.

### Current scrape targets

```yaml
scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'node-exporter'          # VM system metrics
    static_configs:
      - targets: ['node-exporter:9100']

  - job_name: 'soc-portal'             # Portal health check
    static_configs:
      - targets: ['soc-portal:4000']
    metrics_path: /api/health

  - job_name: 'grafana'
    static_configs:
      - targets: ['grafana:3000']
    metrics_path: /metrics
```

### Add a Linux endpoint (Node Exporter)

Install Node Exporter on the target machine first (see the Agents page in the portal for the full install command), then add a scrape job:

```yaml
  - job_name: 'web-server-01'
    static_configs:
      - targets: ['192.168.1.50:9100']
```

Restart Prometheus to pick up the change:

```bash
docker compose --env-file .env restart prometheus
```

Verify the target appeared:

```bash
# From the VM
curl -s http://localhost:9090/api/v1/targets | python3 -m json.tool | grep -A3 '"job"'
# Or open https://<VM-IP>/prometheus/targets in the browser
```

### Add a Windows endpoint (Windows Exporter)

Windows Exporter listens on port 9182 by default:

```yaml
  - job_name: 'windows-desktop-01'
    static_configs:
      - targets: ['192.168.1.60:9182']
```

### Add SNMP monitoring (network devices)

SNMP targets are configured in `configs/prometheus/snmp_targets.yml`:

```yaml
# configs/prometheus/snmp_targets.yml
- targets:
    - 192.168.1.1    # router
    - 192.168.1.2    # switch
  labels:
    job: snmp-endpoints
```

The SNMP module config is in `configs/prometheus/snmp.yml`. Community string defaults to `public` — change it to match your device:

```yaml
modules:
  default:
    walk:
      - 1.3.6.1.2.1.1       # system info
      - 1.3.6.1.2.1.2       # interfaces
    auth:
      community: public      # change this
```

### Tune scrape interval

Default is 15s. Increase for low-power devices, decrease for more granularity:

```yaml
global:
  scrape_interval: 30s        # change here affects all jobs
  evaluation_interval: 30s
```

---

## 2. Zeek

**Config file:** `configs/zeek/local.zeek`

### What it does
Passively captures network traffic on the host interface and writes structured JSON logs: `conn.log` (all connections), `dns.log`, `http.log`, `ssl.log`, `ssh.log`, `notice.log` (alerts), and more.

### Set the correct network interface

The interface is read from `SOC_NETWORK_INTERFACE` in your `.env`. Verify it matches what `ip link show` returns:

```bash
# On the VM — find the bridged interface
ip link show
# Look for the interface with your LAN IP, e.g. ens33, eth0, enp3s0

# Update .env
SOC_NETWORK_INTERFACE=ens33
```

Restart Zeek after changing:

```bash
docker compose --env-file .env up -d zeek
```

### Verify Zeek is capturing

```bash
# Log files should appear and grow within seconds of traffic
docker exec soc-zeek ls -la /usr/local/zeek/logs/current/

# Watch conn.log live — a new line per connection
docker exec soc-zeek tail -f /usr/local/zeek/logs/current/conn.log

# Generate traffic then check
curl http://example.com > /dev/null
# You should see a new JSON line in conn.log
```

### Enable additional protocols

Add any of these lines to `configs/zeek/local.zeek`:

```zeek
@load base/protocols/rdp        # Remote Desktop
@load base/protocols/smb        # Windows file sharing
@load base/protocols/mysql      # MySQL queries
@load base/protocols/kerberos   # Kerberos auth (AD environments)
@load base/protocols/modbus     # Industrial/OT environments
@load base/protocols/dnp3       # SCADA protocols
```

### Add Intel feeds (threat intelligence)

Zeek can match traffic against known-bad IPs, domains, and file hashes:

```bash
# Create an intel file
cat > configs/zeek/intel.dat << 'EOF'
#fields indicator  indicator_type  meta.source  meta.desc
192.168.1.99  Intel::ADDR  manual  test-bad-ip
evil.example.com  Intel::DOMAIN  manual  test-bad-domain
EOF
```

Then load it in `local.zeek`:

```zeek
redef Intel::read_files += { "/usr/local/zeek/share/zeek/site/intel.dat" };
```

Mount the file in `docker-compose.yml`:

```yaml
volumes:
  - ./configs/zeek/intel.dat:/usr/local/zeek/share/zeek/site/intel.dat:ro
```

### Feed Zeek logs into Wazuh

Add these entries to `configs/wazuh/manager/ossec.conf` inside `<ossec_config>`:

```xml
<localfile>
  <log_format>json</log_format>
  <location>/data/zeek/current/conn.log</location>
  <label key="service">zeek-conn</label>
</localfile>

<localfile>
  <log_format>json</log_format>
  <location>/data/zeek/current/notice.log</location>
  <label key="service">zeek-notice</label>
</localfile>

<localfile>
  <log_format>json</log_format>
  <location>/data/zeek/current/dns.log</location>
  <label key="service">zeek-dns</label>
</localfile>
```

The portal's Docker volume already mounts `zeek-logs` at `/data/zeek` — this wires the logs through.

---

## 3. Suricata

**Config file:** `configs/suricata/suricata.yaml`

### What it does
Network IDS/IPS. Matches traffic against a ruleset and writes alerts to `eve.json` in JSON format. Wazuh ingests `eve.json` to generate SIEM alerts.

### Set the correct network interface

Same as Zeek — driven by `SOC_NETWORK_INTERFACE` in `.env`:

```bash
SOC_NETWORK_INTERFACE=ens33
```

### Verify Suricata is running and alerting

```bash
# Check stats (updates every 8 seconds)
docker exec soc-suricata tail -f /var/log/suricata/stats.log | grep capture

# Trigger a known test alert
curl http://testmyids.com

# Check eve.json for the alert (look for "event_type":"alert")
docker exec soc-suricata tail -f /var/log/suricata/eve.json | python3 -m json.tool
```

### Update the ruleset

Suricata rules should be updated regularly. Run inside the container:

```bash
docker exec soc-suricata suricata-update
docker compose --env-file .env restart suricata
```

To automate daily updates, add a cron job on the VM:

```bash
echo "0 3 * * * docker exec soc-suricata suricata-update && docker compose -f /path/to/soc-portal/docker-compose.yml restart suricata" | sudo tee -a /etc/cron.d/suricata-update
```

### Tune HOME_NET to match your network

The `HOME_NET` variable tells Suricata what IPs are "internal". Update it in `suricata.yaml` to match your LAN:

```yaml
vars:
  address-groups:
    HOME_NET: "[192.168.10.0/24]"   # change to your subnet
```

Restart after saving:

```bash
docker compose --env-file .env restart suricata
```

### Add custom rules

Create `configs/suricata/local.rules` and mount it:

```bash
# configs/suricata/local.rules
alert http any any -> $HOME_NET any (msg:"Suspicious User-Agent"; \
  http.user_agent; content:"sqlmap"; nocase; \
  sid:9000001; rev:1;)

alert dns any any -> any any (msg:"DNS query to suspicious TLD"; \
  dns.query; content:".tk"; endswith; nocase; \
  sid:9000002; rev:1;)
```

Mount in `docker-compose.yml` under the `suricata` service:

```yaml
volumes:
  - ./configs/suricata/local.rules:/var/lib/suricata/rules/local.rules:ro
```

Then reference it in `suricata.yaml`:

```yaml
rule-files:
  - suricata.rules
  - local.rules
```

### Feed Suricata alerts into Wazuh

Add to `configs/wazuh/manager/ossec.conf`:

```xml
<localfile>
  <log_format>json</log_format>
  <location>/data/suricata/eve.json</location>
  <label key="service">suricata</label>
</localfile>
```

---

## 4. Wazuh

**Config files:**
- `configs/wazuh/manager/ossec.conf` — main manager config
- `configs/wazuh/manager/local_rules.xml` — custom detection rules

### What it does
Collects logs from agents, applies detection rules, and generates alerts stored in OpenSearch. The SOC portal reads these alerts via the Wazuh API.

### Change the alert threshold

By default all alerts at level 3+ are logged. To reduce noise, raise the threshold:

```xml
<!-- configs/wazuh/manager/ossec.conf -->
<alerts>
  <log_alert_level>5</log_alert_level>   <!-- was 3 -->
</alerts>
```

### Enable email notifications

```xml
<global>
  <email_notification>yes</email_notification>
  <smtp_server>smtp.gmail.com</smtp_server>
  <email_from>soc@yourdomain.com</email_from>
  <email_to>analyst@yourdomain.com</email_to>
  <email_maxperhour>12</email_maxperhour>
  <email_alert_level>12</email_alert_level>
</global>
```

### Add a custom detection rule

Rules go in `configs/wazuh/manager/local_rules.xml`. Rule IDs must start at 100000+.

**Example — detect nmap scan:**

```xml
<rule id="100800" level="8">
  <if_group>firewall</if_group>
  <match>SYN</match>
  <same_source_ip frequency="50" timeframe="10" />
  <description>Possible port scan from $(srcip)</description>
  <mitre><id>T1046</id></mitre>
  <group>attack,reconnaissance</group>
</rule>
```

**Example — detect large data exfiltration:**

```xml
<rule id="100900" level="12">
  <if_group>syslog</if_group>
  <match>scp|rsync|curl|wget</match>
  <regex>\d{3,}\.\d+ MB</regex>
  <description>Large data transfer detected on $(agent.name)</description>
  <mitre><id>T1048</id></mitre>
  <group>attack,exfiltration</group>
</rule>
```

Apply changes without full restart:

```bash
docker exec soc-wazuh-manager /var/ossec/bin/wazuh-logtest
# Or do a full config reload:
docker compose --env-file .env restart wazuh-manager
```

### Monitor additional log files on agents

Add `<localfile>` blocks to `ossec.conf` to collect logs from enrolled agents. These are collected from the **agent side** — edit the agent's `ossec.conf` (at `/var/ossec/etc/ossec.conf` on the agent machine):

```xml
<!-- Collect Apache logs -->
<localfile>
  <log_format>apache</log_format>
  <location>/var/log/apache2/access.log</location>
</localfile>

<!-- Collect auth logs -->
<localfile>
  <log_format>syslog</log_format>
  <location>/var/log/auth.log</location>
</localfile>

<!-- Collect Docker container logs -->
<localfile>
  <log_format>json</log_format>
  <location>/var/lib/docker/containers/*/*.log</location>
</localfile>
```

### Enable vulnerability detection (built-in scanner)

Wazuh has a built-in vulnerability scanner — no OpenVAS needed:

```xml
<!-- Add to ossec.conf -->
<vulnerability-detector>
  <enabled>yes</enabled>
  <interval>12h</interval>
  <ignore_time>6h</ignore_time>
  <run_on_start>yes</run_on_start>
  <provider name="nvd">
    <enabled>yes</enabled>
    <update_interval>1h</update_interval>
  </provider>
</vulnerability-detector>
```

### Verify Wazuh is fully working

```bash
# Check manager is accepting agents
docker exec soc-wazuh-manager /var/ossec/bin/agent_control -l

# Check rules are loading without errors
docker exec soc-wazuh-manager /var/ossec/bin/wazuh-logtest -t

# Check API is responding
docker exec soc-wazuh-manager curl -sk \
  -u wazuh-wui:ChangeThisWazuhPassword1! \
  https://localhost:55000/ | python3 -m json.tool | head -10
```

---

## 5. Grafana

**Config files:** `configs/grafana/provisioning/`

### What it does
Visualizes metrics from Prometheus (system health) and alerts from Wazuh/OpenSearch. The SOC dashboard is auto-provisioned on first start.

### Access Grafana

```
https://<VM-IP>/grafana
Username: admin
Password: GRAFANA_PASSWORD from .env
```

### Add a new Prometheus scrape target and see it in Grafana

1. Add the target to `configs/prometheus/prometheus.yml` (see Section 1)
2. Restart Prometheus: `docker compose --env-file .env restart prometheus`
3. In Grafana → **Explore** → select **Prometheus** datasource → query the new metric

### Create a dashboard for Suricata/Zeek alerts

1. Grafana → **Dashboards → New → New Dashboard**
2. Add panel → select **Wazuh-OpenSearch** datasource
3. Use this Lucene query to show Suricata alerts:
   ```
   data.service:suricata AND rule.level:>6
   ```
4. For Zeek notices:
   ```
   data.service:zeek-notice
   ```

### Add the Loki datasource (if you added Loki for log viewing)

1. Grafana → **Connections → Data sources → Add**
2. Select **Loki**
3. URL: `http://loki:3100`
4. Save & test

### Change the admin password

```bash
docker exec soc-grafana grafana-cli admin reset-admin-password NewPassword1!
```

Or update `GRAFANA_PASSWORD` in `.env` and restart:

```bash
docker compose --env-file .env restart grafana
```

---

## 6. Ollama (LLM)

**Config:** `.env` file → `OLLAMA_MODEL`

### What it does
Runs the local LLM used for AI Triage analysis and AI Chat. No internet API key needed.

### Current model

```
OLLAMA_MODEL=qwen2.5:7b-instruct-q4_K_M   # ~4.4 GB disk, ~5 GB RAM
```

### Switch to a different model

Update `.env`, then re-run the puller:

```bash
# Update in .env:
OLLAMA_MODEL=mistral:7b

# Re-pull
docker compose --env-file .env up -d ollama-init
docker logs soc-ollama-init -f
```

### List available models

```bash
docker exec soc-ollama ollama list
```

### Pull an additional model (for use in AI Chat model selector)

```bash
docker exec soc-ollama ollama pull phi3:mini
```

### Remove a model to free disk space

```bash
docker exec soc-ollama ollama rm llama3.2:3b
```

### Model size reference

| Model | Disk | RAM needed | Quality |
|-------|------|-----------|---------|
| `qwen2.5:7b-instruct-q4_K_M` | 4.4 GB | ~5 GB | Recommended for 16 GB RAM |
| `llama3.1:8b` | 4.7 GB | ~5 GB | Good alternative |
| `mistral:7b` | 4.1 GB | ~5 GB | Fast responses |
| `llama3.2:3b` | 2.0 GB | ~3 GB | Minimal, fastest |

---

## 7. OpenCTI

**Config:** `.env` file (all OpenCTI settings)

### What it does
Threat intelligence platform. Stores and correlates indicators of compromise (IOCs), TTPs, threat actors, and campaigns. Connects to external threat feeds via connectors.

### First-time setup checklist

```bash
# 1. Set a real UUID token in .env before starting
python3 -c "import uuid; print(uuid.uuid4())"
# Paste result into .env: OPENCTI_ADMIN_TOKEN=<uuid>

# 2. Start OpenCTI
docker compose --env-file .env up -d \
  opencti-redis opencti-rabbitmq opencti-minio opencti-elasticsearch opencti

# 3. Monitor startup (takes 3–5 min on first boot)
docker logs soc-opencti -f
# Ready when: "GraphQL server ready"

# 4. Access
# https://<VM-IP>/opencti
# Login: OPENCTI_ADMIN_EMAIL / OPENCTI_ADMIN_PASSWORD from .env
```

### Add threat intelligence connectors

Connectors pull data from external sources. Add them in `docker-compose.yml`.

**MITRE ATT&CK (free):**

```yaml
  opencti-connector-mitre:
    image: opencti/connector-mitre:6.1.2
    container_name: soc-opencti-connector-mitre
    restart: unless-stopped
    environment:
      - OPENCTI_URL=http://opencti:8080/opencti
      - OPENCTI_TOKEN=${OPENCTI_ADMIN_TOKEN}
      - CONNECTOR_ID=<generate a new UUID>
      - CONNECTOR_TYPE=EXTERNAL_IMPORT
      - CONNECTOR_NAME=MITRE ATT&CK
      - CONNECTOR_SCOPE=identity,attack-pattern,course-of-action,intrusion-set,campaign,malware,tool,vulnerability
      - CONNECTOR_RUN_AND_TERMINATE=false
      - CONNECTOR_LOG_LEVEL=error
      - MITRE_INTERVAL=7   # days between updates
    networks:
      soc-net:
    depends_on:
      - opencti
```

**CISA Known Exploited Vulnerabilities (free):**

```yaml
  opencti-connector-cisa-kev:
    image: opencti/connector-cisa-known-exploited-vulnerabilities:6.1.2
    container_name: soc-opencti-connector-cisa
    restart: unless-stopped
    environment:
      - OPENCTI_URL=http://opencti:8080/opencti
      - OPENCTI_TOKEN=${OPENCTI_ADMIN_TOKEN}
      - CONNECTOR_ID=<generate a new UUID>
      - CONNECTOR_TYPE=EXTERNAL_IMPORT
      - CONNECTOR_NAME=CISA KEV
      - CONNECTOR_SCOPE=vulnerability
      - CONNECTOR_LOG_LEVEL=error
    networks:
      soc-net:
    depends_on:
      - opencti
```

Generate a UUID for each connector:

```bash
python3 -c "import uuid; print(uuid.uuid4())"
```

### Export IOCs to Wazuh

Once you have IOCs in OpenCTI, export them as a CDB list for Wazuh:

1. OpenCTI → **Data → Indicators** → filter by type (IP, domain, hash)
2. Export → CSV
3. Convert to Wazuh CDB format and mount in Wazuh manager

---

## 8. Velociraptor

**Config:** Auto-generated on first boot at `/velociraptor/server.config.yaml` inside the container

### What it does
Endpoint visibility and Digital Forensics & Incident Response (DFIR). Agents installed on endpoints stream live data — running processes, network connections, file activity, registry keys — back to the server. You can run hunts across all enrolled endpoints simultaneously.

### Access

```
https://<VM-IP>:8889
Username: admin
Password: VELOCIRAPTOR_ADMIN_PASSWORD from .env
```

> Uses Velociraptor's own self-signed TLS certificate — click through the browser warning.

### Enrol an endpoint (Linux)

1. In the Velociraptor UI → **Clients → Add client**
2. Select **Linux** → download the agent binary
3. On the target machine:
   ```bash
   chmod +x velociraptor-agent
   sudo ./velociraptor-agent config client > /etc/velociraptor/client.yaml
   sudo ./velociraptor-agent --config /etc/velociraptor/client.yaml client -v &
   ```
4. The client appears in the **Clients** list within 30 seconds

### Enrol an endpoint (Windows)

1. UI → **Clients → Add client → Windows**
2. Download the MSI installer
3. Run on the Windows machine as Administrator:
   ```powershell
   msiexec /i velociraptor.msi /quiet
   ```

### Run a hunt (collect data from all endpoints)

1. UI → **Hunts → New Hunt**
2. Select an artifact, e.g.:
   - `Windows.System.Pslist` — running processes
   - `Linux.Sys.Users` — local user accounts
   - `Generic.Network.Netstat` — active connections
   - `Windows.EventLogs.Evtx` — Windows event logs
3. Click **Launch** — results stream in from all enrolled clients

### Common artifacts for incident response

| Artifact | What it collects |
|----------|-----------------|
| `Windows.System.Pslist` | Running processes + parent PIDs |
| `Windows.Network.Netstat` | Active connections |
| `Windows.Registry.NTUser` | User registry hive |
| `Windows.Forensics.Prefetch` | Recently executed programs |
| `Linux.Sys.Users` | Local accounts + sudoers |
| `Linux.Network.NetstatUnix` | Active sockets |
| `Generic.Forensic.LocalHashes` | Hash all files in a directory |

### Export Velociraptor alerts to Wazuh

Velociraptor can forward results to a syslog server, which Wazuh can then ingest:

1. UI → **Server Artifacts → Server.Alerts.Monitor**
2. Configure syslog target: `soc-wazuh-manager:514`
3. In `ossec.conf` on the manager, add a UDP listener:
   ```xml
   <remote>
     <connection>syslog</connection>
     <port>514</port>
     <protocol>udp</protocol>
   </remote>
   ```

---

## 9. Nginx

**Config file:** `configs/nginx/nginx.conf.template`

### What it does
Reverse proxy and TLS terminator. All services are accessed through nginx on ports 80 (redirects to HTTPS) and 443.

### Current routes

| Path | Backend | Auth required |
|------|---------|--------------|
| `/` | SOC Portal :4000 | No (portal has its own login) |
| `/api/` | SOC Portal :4000 | No (API handles JWT auth) |
| `/grafana/` | Grafana :3000 | Yes (SSO) |
| `/wazuh/` | Wazuh Dashboard :5601 | Yes (SSO) |
| `/prometheus/` | Prometheus :9090 | Yes (SSO) |
| `/opencti/` | OpenCTI :8080 | Yes (SSO) |

### Add a new service behind nginx

Add a location block to `configs/nginx/nginx.conf.template`:

```nginx
# Example: expose a new service at /myservice/
location /myservice/ {
    auth_request      /auth-check;
    error_page 401 = @sso_login;

    set $upstream_myservice http://my-container:8080;
    proxy_pass         $upstream_myservice/;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
}
```

Then restart nginx:

```bash
docker compose --env-file .env restart nginx
```

### Replace the self-signed certificate with a real one

```bash
# Option A — Let's Encrypt (if the VM has a public domain)
sudo apt install certbot
sudo certbot certonly --standalone -d yourdomain.com
sudo cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem configs/nginx/certs/server.crt
sudo cp /etc/letsencrypt/live/yourdomain.com/privkey.pem  configs/nginx/certs/server.key
docker compose --env-file .env restart nginx

# Option B — Your own cert
cp /path/to/your.crt configs/nginx/certs/server.crt
cp /path/to/your.key configs/nginx/certs/server.key
docker compose --env-file .env restart nginx
```

### Change rate limits

```nginx
# In nginx.conf.template — current limits:
limit_req_zone $binary_remote_addr zone=portal:10m rate=30r/m;   # login page
limit_req_zone $binary_remote_addr zone=api:10m    rate=120r/m;  # API calls

# Increase if legitimate users are getting 429s:
limit_req_zone $binary_remote_addr zone=api:10m rate=300r/m;
```

---

## Quick Config Reference

| What to change | File | Restart needed |
|----------------|------|---------------|
| Add Prometheus scrape target | `configs/prometheus/prometheus.yml` | `prometheus` |
| Change Zeek interface | `.env` → `SOC_NETWORK_INTERFACE` | `zeek` |
| Change Suricata interface | `.env` → `SOC_NETWORK_INTERFACE` | `suricata` |
| Update Suricata rules | `docker exec soc-suricata suricata-update` | `suricata` |
| Add Wazuh detection rule | `configs/wazuh/manager/local_rules.xml` | `wazuh-manager` |
| Change Wazuh alert level | `configs/wazuh/manager/ossec.conf` | `wazuh-manager` |
| Switch LLM model | `.env` → `OLLAMA_MODEL` + re-run `ollama-init` | `ollama` |
| Add nginx route | `configs/nginx/nginx.conf.template` | `nginx` |
| Replace TLS cert | `configs/nginx/certs/` | `nginx` |
| OpenCTI credentials | `.env` → `OPENCTI_ADMIN_*` | `opencti` |

---

*Last updated: 2026-05-19*

# SOC Portal Running Guide

This guide explains how to run the SOC Manager stack and the Endpoint (client) agent with SNMP monitoring.

## 1) Prerequisites
- Docker Desktop or Docker Engine + Docker Compose v2
- At least 16 GB RAM (32 GB recommended)
- Open ports on the manager host: `80`, `443`, `1514/tcp`, `1514/udp`, `1515`, `55000`
- SNMP uses UDP `161` on each endpoint

## 2) Manager Stack (Full SOC Platform)
The manager stack runs Wazuh Manager/Indexer/Dashboard, Grafana, OpenVAS, Zeek, Suricata, Ollama, and the SOC Portal UI.

> [!NOTE]
> All Dockerfiles have been **optimized** for size and security using multi-stage builds. The portal and other components run as non-root users where possible.

### Option A: Run directly on the host
```bash
cp .env.example .env
bash scripts/generate-certs.sh
./setup.sh start
```

### Option B: Run via the manager container
Build:
```bash
docker build -t soc-manager -f deploy/manager/Dockerfile .
```

Run (mount Docker socket + repo):
**PowerShell**
```powershell
docker run -d --name soc-manager `
  -v /var/run/docker.sock:/var/run/docker.sock `
  -v ${PWD}:/stack `
  soc-manager
```

**CMD**
```bat
docker run -d --name soc-manager -v //var/run/docker.sock:/var/run/docker.sock -v %cd%:/stack soc-manager
```

## 3) Endpoint Agent (Wazuh + SNMP)
Each endpoint runs a lightweight agent container with Wazuh agent + SNMP daemon.

Build:
```bash
docker build -t soc-agent -f deploy/client/Dockerfile .
```

Run:
```bash
docker run -d --name soc-agent \
  -e WAZUH_MANAGER=MANAGER_IP \
  -e WAZUH_AGENT_NAME=endpoint-01 \
  -e SNMP_COMMUNITY=public \
  -p 161:161/udp \
  soc-agent
```

Optional authd enrollment:
```bash
-e WAZUH_REGISTRATION_PASSWORD=your_authd_password
```

## 4) SNMP Health Monitoring
Prometheus scrapes SNMP via `snmp-exporter`.

### Add endpoints to scrape
Edit:
```
configs/prometheus/snmp_targets.yml
```

Example:
```
- targets:
  - 192.168.1.10
  - 192.168.1.11
  labels:
    job: snmp-endpoints
```

### SNMP community
Edit:
```
configs/prometheus/snmp.yml
```

Default:
```
community: public
```

Restart the stack after changes:
```bash
./setup.sh restart
```

## 4.1) Auto SNMP Targets
The portal auto-syncs Wazuh agent IPs to:
```
configs/prometheus/snmp_targets.auto.yml
```
Manual targets can still be kept in:
```
configs/prometheus/snmp_targets.yml
```

## 4.2) Portal Panel
Dashboard → **Endpoint Health (SNMP)** shows up/down status and scrape time.

## 5) Access URLs (Manager Host)
- SOC Portal: `http://localhost`
- Grafana: `http://localhost/grafana`
- Wazuh Dashboard: `http://localhost/wazuh`
- OpenVAS: `http://localhost/openvas`

## 6) Default Logins
- SOC Portal: `admin / SocPortal1!`
- Grafana: `admin / SocGrafana1!`
- Wazuh: `admin / SecurePassword1!`
- OpenVAS: `admin / SecureOpenVAS1!`

## 7) Common Commands
```bash
./setup.sh status
./setup.sh logs
./setup.sh stop
./setup.sh restart
```

## 8) Notes
- First startup can take 5–15 minutes (OpenVAS + image pulls).
- **Optimization**: This stack uses **multi-stage Docker builds**. The build-time dependencies are discarded in the final image, resulting in a minimal production footprint and high security.
- **Frontend Config**: The portal uses `vite.config.mjs`, `postcss.config.mjs`, and `tailwind.config.mjs`. These use ESM syntax to ensure compatibility with modern build tools.
- Ollama pulls the default model on first run.
- Change all default passwords in `.env` before any production use.

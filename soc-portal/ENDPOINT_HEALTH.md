# Endpoint Health (SNMP) Guide

This document explains how SNMP health monitoring works and how to run it.

## 1) What You Get
- Endpoint health status (up/down) via SNMP
- Prometheus scraping through `snmp-exporter`
- Grafana dashboards for SNMP metrics
- SOC Portal panel: **Dashboard → Endpoint Health (SNMP)**

## 2) Enable SNMP on Endpoints
### Option A: Client container (recommended)
```bash
docker build -t soc-agent -f deploy/client/Dockerfile .
docker run -d --name soc-agent \
  -e WAZUH_MANAGER=MANAGER_IP \
  -e WAZUH_AGENT_NAME=endpoint-01 \
  -e SNMP_COMMUNITY=public \
  -p 161:161/udp \
  soc-agent
```

### Option B: Native install (Linux)
Use the enrollment script (includes snmpd):
```bash
bash scripts/enroll-agent.sh linux
```

## 3) SNMP Targets (Auto + Manual)
The portal auto‑syncs Wazuh agent IPs into:
```
configs/prometheus/snmp_targets.auto.yml
```

Manual targets can still be placed in:
```
configs/prometheus/snmp_targets.yml
```

Prometheus loads both files.

## 4) Portal Panel
The SOC Portal dashboard shows a **Endpoint Health (SNMP)** panel with:
- endpoint IP
- up/down status
- scrape time

## 5) Restart (if needed)
```bash
./setup.sh restart
```

## 6) Configuration
SNMP community and modules:
```
configs/prometheus/snmp.yml
```

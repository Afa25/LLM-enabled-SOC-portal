const express = require('express');
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const { auth } = require('./auth');

const router = express.Router();

// ── Tool definitions ──────────────────────────────────────────
// internalUrl: checked server-side (Docker network)
// path:        appended to internalUrl for the health probe
const TOOLS = [
  {
    id: 'wazuh-dashboard',
    name: 'Wazuh Dashboard',
    category: 'SIEM',
    description: 'Security alerts, agent management, rule editor, and compliance dashboards.',
    internalUrl: 'http://wazuh-dashboard:5601',
    path: '/wazuh/',
    externalPath: '/wazuh/',
    loginHint: 'Use your Wazuh admin credentials from .env',
    color: 'blue',
    hasUI: true,
  },
  {
    id: 'grafana',
    name: 'Grafana',
    category: 'Metrics',
    description: 'Time-series dashboards for host metrics, alert trends, and system health.',
    internalUrl: 'http://grafana:3000',
    path: '/api/health',
    externalPath: '/grafana/',
    loginHint: 'Use your Grafana admin credentials from .env',
    color: 'orange',
    hasUI: true,
  },
  {
    id: 'prometheus',
    name: 'Prometheus',
    category: 'Metrics',
    description: 'Time-series metrics collection. Scrapes node-exporter and portal metrics.',
    internalUrl: 'http://prometheus:9090',
    path: '/prometheus/-/healthy',
    externalPath: '/prometheus/',
    loginHint: null,
    color: 'red',
    hasUI: true,
  },
  {
    id: 'openvas',
    name: 'OpenVAS',
    category: 'Vulnerability',
    description: 'Greenbone vulnerability scanner. Run network-wide vulnerability assessments.',
    internalUrl: 'http://openvas:9392',
    path: '/',
    externalPath: 'http://localhost:9392',
    loginHint: 'Use your OpenVAS admin credentials from .env',
    color: 'green',
    hasUI: true,
    startCmd: 'docker compose --env-file .env up -d openvas',
    note: 'First start takes 10–20 min for NVT feed sync. Opens on direct port — no sub-path proxy.',
  },
  {
    id: 'ollama',
    name: 'Ollama LLM',
    category: 'AI',
    description: 'Local large language model server. Powers AI Triage and AI Chat features.',
    internalUrl: 'http://ollama:11434',
    path: '/api/tags',
    externalPath: null,
    credentials: null,
    color: 'purple',
    hasUI: false,
    note: 'REST API only — no browser UI. Accessed via AI Chat and AI Triage.',
  },
  {
    id: 'zeek',
    name: 'Zeek',
    category: 'Network',
    description: 'Network traffic analyser. Writes conn.log, dns.log, http.log to the zeek-logs volume.',
    internalUrl: null,
    path: null,
    externalPath: null,
    credentials: null,
    color: 'cyan',
    hasUI: false,
    note: 'Not supported on Windows Docker Desktop — network_mode: host is unavailable. Requires a Linux host with native Docker to capture host network traffic.',
  },
  {
    id: 'suricata',
    name: 'Suricata',
    category: 'Network',
    description: 'Network IDS/IPS. Writes eve.json alerts to the suricata-logs volume.',
    internalUrl: null,
    path: null,
    externalPath: null,
    credentials: null,
    color: 'yellow',
    hasUI: false,
    note: 'Not supported on Windows Docker Desktop — network_mode: host is unavailable. Requires a Linux host with native Docker to capture host network traffic.',
  },
];

// ── GET /api/tools — list tools with live status ──────────────
router.get('/', auth, async (req, res) => {
  const results = await Promise.all(
    TOOLS.map(async tool => {
      const base = { ...tool };
      delete base.internalUrl;
      delete base.path;
      delete base.credentials; // never expose credentials to the client

      if (!tool.internalUrl) {
        return { ...base, status: 'no-ui' };
      }

      try {
        const r = await fetch(`${tool.internalUrl}${tool.path}`, {
          signal: AbortSignal.timeout(3000),
          redirect: 'follow',
        });
        const up = r.status < 500;
        return { ...base, status: up ? 'up' : 'degraded' };
      } catch {
        return { ...base, status: 'down' };
      }
    })
  );

  res.json(results);
});

module.exports = router;

const express = require('express');
const https   = require('https');
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const { auth } = require('./auth');

// Health probes only — skip cert validation for self-signed internal services
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

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
    internalUrl: 'https://wazuh-dashboard:5601',
    path: '/',
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
    id: 'opencti',
    name: 'OpenCTI',
    category: 'Threat Intel',
    description: 'Threat intelligence platform. Manage IOCs, TTPs, and threat actor profiles.',
    internalUrl: 'http://opencti:8080',
    path: '/opencti/graphql',
    externalPath: '/opencti/',
    loginHint: 'Use your OpenCTI admin credentials from .env',
    color: 'red',
    hasUI: true,
  },
  {
    id: 'velociraptor',
    name: 'Velociraptor',
    category: 'DFIR',
    description: 'Endpoint visibility and digital forensics. Run hunts and collect artifacts.',
    internalUrl: 'https://velociraptor:8889',
    path: '/app/index.html',
    externalPath: null,
    directPort: 8889,
    loginHint: 'Use Velociraptor admin credentials from .env',
    color: 'green',
    hasUI: true,
    note: 'Served on its own HTTPS port — opens in a new tab at https://<server>:8889',
  },
  {
    id: 'prometheus',
    name: 'Prometheus',
    category: 'Metrics',
    description: 'Agent and host metrics collection. Scrapes enrolled agent exporters and host metrics.',
    internalUrl: 'http://prometheus:9090',
    path: '/-/healthy',
    externalPath: '/prometheus/',
    color: 'red',
    hasUI: true,
    note: 'Access via /prometheus/ — also visible as a Grafana datasource.',
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
    note: 'Requires Linux host with native Docker (network_mode: host). Not available on Windows Docker Desktop.',
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
    note: 'Requires Linux host with native Docker (network_mode: host). Not available on Windows Docker Desktop.',
  },
];

// ── GET /api/tools — list tools with live status ──────────────
router.get('/', auth, async (req, res) => {
  const results = await Promise.all(
    TOOLS.map(async tool => {
      const base = { ...tool };
      delete base.internalUrl;
      delete base.path;
      delete base.credentials;

      if (!tool.internalUrl) {
        return { ...base, status: 'no-ui' };
      }

      try {
        const fetchOpts = {
          signal: AbortSignal.timeout(3000),
          redirect: 'follow',
        };
        if (tool.internalUrl.startsWith('https://')) {
          fetchOpts.agent = insecureAgent;
        }
        const r = await fetch(`${tool.internalUrl}${tool.path}`, fetchOpts);
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

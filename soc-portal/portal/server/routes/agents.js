const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const wazuh    = require('../services/wazuh');
const { auth } = require('./auth');
const router   = express.Router();

const TARGETS_FILE = process.env.PROMETHEUS_TARGETS_FILE || '/etc/prometheus/targets/agents.json';

function readTargets() {
  try { return JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf8')); } catch { return []; }
}

function writeTargets(targets) {
  fs.mkdirSync(path.dirname(TARGETS_FILE), { recursive: true });
  fs.writeFileSync(TARGETS_FILE, JSON.stringify(targets, null, 2));
}

router.get('/', auth, async (req, res) => {
  try {
    const agents = await wazuh.getAgents();
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/agents/enroll-info ───────────────────────────────
// Returns externally reachable connection details used to build enrollment
// commands. Docker services keep their internal DNS names, but endpoints must
// use the host device IP, not a Docker bridge/NAT address.
router.get('/enroll-info', auth, (req, res) => {
  const serverHint = process.env.SERVER_IP || req.headers.host?.split(':')[0] || 'localhost';
  res.json({
    wazuh_version:  '4.12.0',
    wazuh_port:     1514,
    wazuh_enroll:   1515,
    server_hint:    serverHint,
    portal_url:     `https://${serverHint}`,
    wazuh_api_url:  `https://${serverHint}:55000`,
    wazuh_manager:  serverHint,
  });
});

// ── GET /api/agents/metrics-targets ──────────────────────────
// List registered Prometheus scrape targets
router.get('/metrics-targets', auth, (req, res) => {
  res.json(readTargets());
});

// ── POST /api/agents/metrics-targets ─────────────────────────
// Body: { ip, port, labels: { hostname, os } }
// Registers an agent endpoint for Prometheus scraping.
// Call this after enrolling an agent that has node-exporter/windows-exporter installed.
router.post('/metrics-targets', auth, (req, res) => {
  const { ip, port = 9100, labels = {} } = req.body || {};
  if (!ip) return res.status(400).json({ error: 'ip is required' });

  const targets = readTargets();
  const address = `${ip}:${port}`;
  const existing = targets.findIndex(t => t.targets.includes(address));

  const entry = { targets: [address], labels: { instance: ip, ...labels } };
  if (existing >= 0) targets[existing] = entry;
  else targets.push(entry);

  writeTargets(targets);
  res.json({ ok: true, registered: address });
});

// ── DELETE /api/agents/metrics-targets/:ip ────────────────────
router.delete('/metrics-targets/:ip', auth, (req, res) => {
  const { ip } = req.params;
  const targets = readTargets().filter(t => !t.targets.some(a => a.startsWith(`${ip}:`)));
  writeTargets(targets);
  res.json({ ok: true });
});

module.exports = router;

const express  = require('express');
const wazuh    = require('../services/wazuh');
const { auth } = require('./auth');
const router   = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const agents = await wazuh.getAgents();
    res.json(agents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/agents/enroll-info ───────────────────────────────
// Returns server connection details used to build enrollment commands.
// The manager URL is the internal Docker hostname — we return it as-is
// and let the frontend substitute the user-supplied server IP.
router.get('/enroll-info', auth, (req, res) => {
  const managerUrl = process.env.WAZUH_MANAGER_URL || 'https://wazuh-manager:55000';
  res.json({
    wazuh_version:  '4.7.3',
    wazuh_port:     1514,
    wazuh_enroll:   1515,
    prometheus_port: 9090,
    crowdsec_port:  8080,
    openvas_port:   9392,
    // Prefer the explicit SERVER_IP env var; fall back to request host.
    server_hint: process.env.SERVER_IP || req.headers.host?.split(':')[0] || 'localhost',
  });
});

module.exports = router;

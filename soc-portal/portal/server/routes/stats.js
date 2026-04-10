// ─────────────────────────────────────────────────────────────────
// routes/stats.js
// ─────────────────────────────────────────────────────────────────
const express  = require('express');
const wazuh    = require('../services/wazuh');
const { auth } = require('./auth');
const router   = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const hoursBack = parseInt(req.query.hours) || 24;
    const [summary, agents, manager] = await Promise.all([
      wazuh.getAlertsSummary(hoursBack),
      wazuh.getAgents(),
      wazuh.getManagerInfo()
    ]);
    const active   = agents.filter(a => a.status === 'active').length;
    const inactive = agents.filter(a => a.status !== 'active').length;
    const critical = summary.by_level.filter(b => b.key >= 12).reduce((s,b) => s+b.doc_count, 0);
    const high     = summary.by_level.filter(b => b.key >= 7 && b.key < 12).reduce((s,b) => s+b.doc_count, 0);
    res.json({ summary, agents: { total: agents.length, active, inactive }, manager, critical, high });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const { auth } = require('./auth');
const snmp = require('../services/snmp');
const deviceHealth = require('../services/device-health');
const monitor = require('../services/containerMonitor');

const router = express.Router();

// Base health
router.get('/', (_, res) => res.json({ ok: true, ts: new Date() }));

// Live container status (polled every 30s in background)
router.get('/containers', auth, (req, res) => {
  const status = monitor.getStatus();
  const list = Object.values(status);
  const summary = {
    total:      list.length,
    running:    list.filter(c => c.state === 'running').length,
    stopped:    list.filter(c => c.state === 'stopped').length,
    restarting: list.filter(c => c.state === 'restarting').length,
  };
  res.json({ summary, containers: list });
});

// Endpoint health via SNMP
router.get('/endpoints', auth, async (req, res) => {
  try {
    const data = await snmp.getEndpointHealth();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unified device health (inventory + Wazuh + SNMP)
router.get('/devices', auth, async (req, res) => {
  try {
    const data = await deviceHealth.getDeviceHealth();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manual SNMP targets sync
router.post('/endpoints/sync', auth, async (req, res) => {
  try {
    await snmp.syncSnmpTargets();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

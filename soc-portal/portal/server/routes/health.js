const express = require('express');
const { auth } = require('./auth');
const snmp = require('../services/snmp');
const deviceHealth = require('../services/device-health');

const router = express.Router();

// Base health
router.get('/', (_, res) => res.json({ ok: true, ts: new Date() }));

// Endpoint health via SNMP (Prometheus)
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

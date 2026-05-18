const express = require('express');
const { auth, adminOnly } = require('./auth');
const devices = require('../db/devices');

const router = express.Router();
const DEVICE_TOKEN = process.env.DEVICE_INGEST_TOKEN;

function deviceAuth(req, res, next) {
  if (DEVICE_TOKEN && req.headers['x-device-token'] === DEVICE_TOKEN) return next();
  return auth(req, res, next);
}

router.get('/', auth, (req, res) => {
  try {
    const type = req.query.type;
    const data = devices.listDevices({ type });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', auth, (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Device name is required' });
    const created = devices.createDevice(req.body || {});
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', auth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = devices.updateDevice(id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Device not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', auth, adminOnly, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = devices.deleteDevice(id);
    if (!deleted) return res.status(404).json({ error: 'Device not found' });
    res.json({ ok: true, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/heartbeat', deviceAuth, (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = devices.recordHeartbeat(id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Device not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

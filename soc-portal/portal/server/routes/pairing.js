const express = require('express');
const { auth } = require('./auth');
const pairing = require('../db/pairing');

const router = express.Router();

router.post('/start', auth, (req, res) => {
  try {
    const createdBy = req.user?.username || null;
    const data = pairing.createPairing({ createdBy });
    const base = process.env.PAIRING_DEEPLINK_BASE || 'soc-portal://pair';
    const qrPayload = `${base}?token=${data.token}`;
    res.json({ ...data, qr_payload: qrPayload });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/consume', (req, res) => {
  try {
    const { token, code, device } = req.body || {};
    if (!token && !code) return res.status(400).json({ error: 'Token or code is required' });
    const result = pairing.consumePairing({ token, code, device, requestIp: req.ip });
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

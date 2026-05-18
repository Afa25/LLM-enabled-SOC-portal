const express = require('express');
const os      = require('os');
const { auth } = require('./auth');
const router  = express.Router();

// GET /api/settings/network — returns host network interfaces
router.get('/network', auth, (req, res) => {
  const ifaces  = os.networkInterfaces();
  const addrs   = [];

  for (const [name, list] of Object.entries(ifaces)) {
    for (const iface of list) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      addrs.push({ name, address: iface.address });
    }
  }

  // Also include the hostname from the incoming request so the frontend
  // knows what address the browser is currently using.
  const current = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
                || req.headers.host?.split(':')[0]
                || 'localhost';

  res.json({ current, interfaces: addrs });
});

module.exports = router;

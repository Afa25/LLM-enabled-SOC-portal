const express  = require('express');
const wazuh    = require('../services/wazuh');
const { auth } = require('./auth');
const router   = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const alerts = await wazuh.getAlerts({
      limit:  parseInt(req.query.limit)  || 50,
      level:  req.query.level ? parseInt(req.query.level) : undefined,
      from:   req.query.from,
      to:     req.query.to
    });
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

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

module.exports = router;

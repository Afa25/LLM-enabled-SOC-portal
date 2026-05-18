const express  = require('express');
const wazuh    = require('../services/wazuh');
const { auth } = require('./auth');
const router   = express.Router();

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;

function validDate(v) {
  return v === undefined || (typeof v === 'string' && ISO_DATE_RE.test(v) && !isNaN(Date.parse(v)));
}

router.get('/', auth, async (req, res) => {
  const { from, to } = req.query;
  if (!validDate(from) || !validDate(to)) {
    return res.status(400).json({ error: 'Invalid date format. Use ISO 8601 (e.g. 2024-01-01 or 2024-01-01T00:00:00Z).' });
  }

  try {
    const alerts = await wazuh.getAlerts({
      limit:  parseInt(req.query.limit)  || 50,
      level:  req.query.level ? parseInt(req.query.level) : undefined,
      from,
      to
    });
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

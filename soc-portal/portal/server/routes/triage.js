const express    = require('express');
const db         = require('../db/database');
const wazuh      = require('../services/wazuh');
const triageSvc  = require('../services/triage');
const { auth }   = require('./auth');

const router = express.Router();

function parseRow(r) {
  if (!r) return null;
  try { return { ...r, alert_data: JSON.parse(r.alert_data) }; }
  catch { return { ...r, alert_data: {} }; }
}

// ── List all triage results ────────────────────────────────────
router.get('/', auth, (req, res) => {
  const rows = db.get()
    .prepare('SELECT * FROM triage_results ORDER BY created DESC LIMIT 200')
    .all();
  res.json(rows.map(parseRow));
});

// ── Queue: high/critical alerts not yet triaged ───────────────
router.get('/queue', auth, async (req, res) => {
  try {
    const alerts = await wazuh.getAlerts({ limit: 100 });
    const high   = alerts.filter(a => (a?.rule?.level || 0) >= 7);

    const triaged = new Set(
      db.get().prepare('SELECT alert_id FROM triage_results').all().map(r => r.alert_id)
    );

    res.json(high.filter(a => a._id && !triaged.has(a._id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Analyze one alert with the local LLM ──────────────────────
router.post('/analyze', auth, async (req, res) => {
  const alert = req.body;
  if (!alert?._id) return res.status(400).json({ error: 'Alert with _id required' });

  // Return cached result if already analyzed
  const existing = db.get()
    .prepare('SELECT * FROM triage_results WHERE alert_id = ?')
    .get(alert._id);
  if (existing) return res.json(parseRow(existing));

  try {
    // Fetch correlated events: same agent ±5 min
    const t          = new Date(alert.timestamp || Date.now());
    const correlated = await wazuh.getAlerts({
      limit: 20,
      from : new Date(t.getTime() - 300_000).toISOString(),
      to   : new Date(t.getTime() + 300_000).toISOString()
    })
      .then(evts => evts.filter(e =>
        e?.agent?.name === alert?.agent?.name && e._id !== alert._id
      ))
      .catch(() => []);

    const result = await triageSvc.analyzeAlert(alert, correlated);

    const info = db.get().prepare(`
      INSERT INTO triage_results
        (alert_id, alert_data, verdict, confidence, explanation,
         mitre_tactic, recommended_action, model)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      alert._id,
      JSON.stringify(alert),
      result.verdict,
      result.confidence,
      result.explanation,
      result.mitre_tactic,
      result.recommended_action,
      process.env.OLLAMA_MODEL || 'llama3.2:3b'
    );

    res.json(parseRow(
      db.get().prepare('SELECT * FROM triage_results WHERE id = ?').get(info.lastInsertRowid)
    ));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Analyst review: confirm or dismiss ───────────────────────
router.patch('/:id', auth, (req, res) => {
  const { analyst_status, analyst_note } = req.body;
  if (!['confirmed', 'dismissed', 'pending'].includes(analyst_status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const row = db.get()
    .prepare('SELECT id FROM triage_results WHERE id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  db.get().prepare(`
    UPDATE triage_results
    SET analyst_status = ?, analyst_note = ?, reviewed = datetime('now')
    WHERE id = ?
  `).run(analyst_status, analyst_note || null, req.params.id);

  res.json(parseRow(
    db.get().prepare('SELECT * FROM triage_results WHERE id = ?').get(req.params.id)
  ));
});

// ── Delete a triage result ────────────────────────────────────
router.delete('/:id', auth, (req, res) => {
  db.get().prepare('DELETE FROM triage_results WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

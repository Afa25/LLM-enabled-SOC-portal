const express   = require('express');
const db        = require('../db/database');
const { auth, adminOnly } = require('./auth');
const { refreshSchedule, runScheduledReport } = require('../services/scheduler');

const router = express.Router();

const PRESETS = {
  daily:   '0 6 * * *',      // 06:00 every day
  weekly:  '0 7 * * 1',      // 07:00 every Monday
  monthly: '0 8 1 * *'       // 08:00 on 1st of month
};

// List
router.get('/', auth, (req, res) => {
  res.json(db.get().prepare('SELECT * FROM schedules ORDER BY created DESC').all());
});

// Create
router.post('/', auth, adminOnly, (req, res) => {
  const { name, timeframe, cron_expr, model = 'llama3.2:3b' } = req.body;
  if (!name || !timeframe) return res.status(400).json({ error: 'name and timeframe required' });

  const cronFinal = cron_expr || PRESETS[timeframe] || PRESETS.daily;

  const result = db.get().prepare(
    'INSERT INTO schedules (name, timeframe, cron_expr, model) VALUES (?,?,?,?)'
  ).run(name, timeframe, cronFinal, model);

  const schedule = db.get().prepare('SELECT * FROM schedules WHERE id = ?').get(result.lastInsertRowid);
  refreshSchedule(schedule.id);
  res.status(201).json(schedule);
});

// Update
router.put('/:id', auth, adminOnly, (req, res) => {
  const { name, timeframe, cron_expr, model, enabled } = req.body;
  const id = req.params.id;
  const s  = db.get().prepare('SELECT * FROM schedules WHERE id = ?').get(id);
  if (!s) return res.status(404).json({ error: 'Not found' });

  db.get().prepare(`
    UPDATE schedules SET name=?, timeframe=?, cron_expr=?, model=?, enabled=? WHERE id=?
  `).run(
    name       ?? s.name,
    timeframe  ?? s.timeframe,
    cron_expr  ?? s.cron_expr,
    model      ?? s.model,
    enabled !== undefined ? (enabled ? 1 : 0) : s.enabled,
    id
  );

  refreshSchedule(parseInt(id));
  res.json(db.get().prepare('SELECT * FROM schedules WHERE id = ?').get(id));
});

// Delete
router.delete('/:id', auth, adminOnly, (req, res) => {
  db.get().prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Run now (manual trigger)
router.post('/:id/run', auth, adminOnly, async (req, res) => {
  const s = db.get().prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Report generation triggered' });
  runScheduledReport(s).catch(e => console.error(e));
});

module.exports = router;

const express   = require('express');
const db        = require('../db/database');
const wazuh     = require('../services/wazuh');
const ollama    = require('../services/ollama');
const { auth, adminOnly } = require('./auth');

const router = express.Router();

// ── List all reports ───────────────────────────────────────────
router.get('/', auth, (req, res) => {
  const reports = db.get().prepare(
    'SELECT id, title, timeframe, start_date, end_date, model, alert_count, created FROM reports ORDER BY created DESC LIMIT 100'
  ).all();
  res.json(reports);
});

// ── Available LLM models — MUST be before /:id ─────────────────
router.get('/models/list', auth, async (req, res) => {
  try {
    const models = await ollama.listModels();
    res.json(models);
  } catch {
    res.json([process.env.OLLAMA_MODEL || 'llama3.2:3b']);
  }
});

// ── Generate report NOW (on-demand) ───────────────────────────
router.post('/generate', auth, async (req, res) => {
  const {
    timeframe = 'daily',
    startDate,
    endDate,
    model = process.env.OLLAMA_MODEL || 'llama3.2:3b'
  } = req.body;

  const end   = endDate   ? new Date(endDate)   : new Date();
  let   start;
  if (startDate) {
    start = new Date(startDate);
  } else {
    switch (timeframe) {
      case 'weekly':  start = new Date(end - 7*86400_000);  break;
      case 'monthly': start = new Date(end - 30*86400_000); break;
      default:        start = new Date(end - 86400_000);
    }
  }

  const startISO = start.toISOString();
  const endISO   = end.toISOString();

  // Respond immediately — generation runs in background
  res.status(202).json({ message: 'Report generation started', startISO, endISO });

  try {
    const [alertData, agents] = await Promise.all([
      wazuh.getAlertCountByRange(startISO, endISO),
      wazuh.getAgents()
    ]);

    const context = { ...alertData, agents, startDate: startISO, endDate: endISO };
    const content = await ollama.generateReport(context, timeframe, model);

    const title = `${timeframe.charAt(0).toUpperCase()+timeframe.slice(1)} SOC Report — ${end.toLocaleDateString()}`;
    db.get().prepare(
      'INSERT INTO reports (title, timeframe, start_date, end_date, content, model, alert_count) VALUES (?,?,?,?,?,?,?)'
    ).run(title, timeframe, startISO, endISO, content, model, alertData.total);

    db.get().prepare('INSERT INTO audit_log (user,action,detail) VALUES (?,?,?)').run(
      req.user.username, 'REPORT_GENERATED', `${title} | Alerts: ${alertData.total}`
    );
  } catch (err) {
    console.error('[Reports] Generation error:', err.message);
  }
});

// ── SSE streaming endpoint — MUST be before /:id ──────────────
router.get('/stream/:requestId', auth, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { timeframe = 'daily', model = process.env.OLLAMA_MODEL } = req.query;
  const endISO   = new Date().toISOString();
  const startISO = new Date(Date.now() - 86400_000).toISOString();

  try {
    const [alertData, agents] = await Promise.all([
      wazuh.getAlertCountByRange(startISO, endISO),
      wazuh.getAgents()
    ]);
    const context = { ...alertData, agents, startDate: startISO, endDate: endISO };
    let full = '';

    await ollama.streamReport(context, timeframe, model, chunk => {
      full += chunk;
      res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    });

    const title = `${timeframe} SOC Report — ${new Date().toLocaleDateString()} (streamed)`;
    db.get().prepare(
      'INSERT INTO reports (title,timeframe,start_date,end_date,content,model,alert_count) VALUES (?,?,?,?,?,?,?)'
    ).run(title, timeframe, startISO, endISO, full, model, alertData.total);

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// ── Get single report (with content) — wildcard LAST ──────────
router.get('/:id', auth, (req, res) => {
  const r = db.get().prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  res.json(r);
});

// ── Delete report ──────────────────────────────────────────────
router.delete('/:id', auth, adminOnly, (req, res) => {
  db.get().prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

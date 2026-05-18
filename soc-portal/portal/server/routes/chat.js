const express  = require('express');
const fetch    = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const wazuh    = require('../services/wazuh');
const { auth } = require('./auth');

const router     = express.Router();
const OLLAMA_URL = process.env.OLLAMA_URL   || 'http://localhost:11434';
const DEF_MODEL  = process.env.OLLAMA_MODEL || 'llama3.2:3b';

// Sanitize values injected from external data (Wazuh) into the LLM system prompt.
function sanitizeCtx(val, maxLen = 80) {
  if (val === null || val === undefined) return 'unknown';
  return String(val)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\b(IGNORE|DISREGARD|FORGET|SYSTEM|OVERRIDE|INSTRUCTIONS?)\b/gi, '[filtered]')
    .slice(0, maxLen);
}

// ── Build the system prompt, optionally with live SOC context ──
async function buildSystem(useContext) {
  let ctx = '';

  if (useContext) {
    try {
      const [summary, agents] = await Promise.all([
        wazuh.getAlertsSummary(24),
        wazuh.getAgents()
      ]);

      const critical = summary.by_level
        .filter(b => b.key >= 12).reduce((s, b) => s + b.doc_count, 0);
      const high     = summary.by_level
        .filter(b => b.key >= 7 && b.key < 12).reduce((s, b) => s + b.doc_count, 0);
      const topGroups = summary.by_group
        .slice(0, 4).map(b => sanitizeCtx(b.key)).join(', ') || 'none';
      const topAgent  = summary.by_agent[0];
      const active    = agents.filter(a => a.status === 'active').length;

      ctx = `

LIVE SOC CONTEXT — last 24 h as of ${new Date().toISOString()}:
  Total alerts   : ${summary.total}
  Critical (L12+): ${critical}
  High (L7–11)   : ${high}
  Active agents  : ${active} / ${agents.length}
  Top categories : ${topGroups}
  Busiest agent  : ${topAgent ? `${sanitizeCtx(topAgent.key)} (${topAgent.doc_count} alerts)` : 'none'}
`;
    } catch {
      ctx = '\n(Live SOC context unavailable — Wazuh may still be starting up.)';
    }
  }

  return `You are an expert SOC (Security Operations Center) analyst assistant embedded in a security portal. Your role is to help analysts understand threats, investigate alerts, and make decisions.
${ctx}
Guidelines:
- Be concise and actionable. Analysts are under time pressure.
- Reference MITRE ATT\&CK techniques (e.g. T1110) when relevant.
- When discussing alerts, suggest concrete investigation steps.
- Use markdown formatting — headers, bold, bullet lists — for clarity.
- If you don't know something, say so clearly rather than guessing.`;
}

// ── POST /api/chat/stream — SSE streaming chat ─────────────────
const MAX_MESSAGES      = 40;
const MAX_MESSAGE_CHARS = 8000;

// Per-user concurrency guard: one active stream per user at a time
const activeStreams = new Map();

router.post('/stream', auth, async (req, res) => {
  const userId = req.user?.id ?? req.user?.username ?? 'unknown';
  if (activeStreams.has(userId)) {
    return res.status(429).json({ error: 'You already have an active stream. Wait for it to finish.' });
  }
  activeStreams.set(userId, true);
  res.on('close', () => activeStreams.delete(userId));
  const { messages = [], useContext = true } = req.body || {};
  const model = req.body.model || DEF_MODEL;

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }
  if (messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: `Too many messages (max ${MAX_MESSAGES})` });
  }
  const oversized = messages.find(m => typeof m.content === 'string' && m.content.length > MAX_MESSAGE_CHARS);
  if (oversized) {
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_CHARS} characters)` });
  }
  const invalidRole = messages.find(m => !['user', 'assistant'].includes(m.role));
  if (invalidRole) {
    return res.status(400).json({ error: 'Invalid message role' });
  }

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // tell nginx not to buffer
  res.flushHeaders();

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const systemContent = await buildSystem(useContext);

    const allMessages = [
      { role: 'system', content: systemContent },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ model, messages: allMessages, stream: true }),
      signal : AbortSignal.timeout(120_000)
    });

    if (!ollamaRes.ok) {
      send({ error: `Ollama returned ${ollamaRes.status}` });
      return res.end();
    }

    let buffer = '';
    for await (const chunk of ollamaRes.body) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.message?.content) send({ token: obj.message.content });
          if (obj.done)             { send({ done: true }); return res.end(); }
        } catch { /* partial JSON — wait for next chunk */ }
      }
    }

    send({ done: true });
  } catch (err) {
    send({ error: err.message });
  } finally {
    res.end();
  }
});

// ── GET /api/chat/models — list available Ollama models ────────
router.get('/models', auth, async (req, res) => {
  try {
    const r    = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await r.json();
    res.json(data?.models?.map(m => m.name) || [DEF_MODEL]);
  } catch {
    res.json([DEF_MODEL]);
  }
});

module.exports = router;

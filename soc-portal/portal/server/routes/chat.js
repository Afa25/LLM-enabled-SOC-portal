const express = require('express');
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const wazuh   = require('../services/wazuh');
const { auth } = require('./auth');
const { embed }            = require('../services/embeddings');
const { queryDocuments }   = require('../services/vectorStore');
require('../services/ragIndexer'); // starts background indexing on server start

const router     = express.Router();
const OLLAMA_URL = process.env.OLLAMA_URL   || 'http://localhost:11434';
const DEF_MODEL  = process.env.OLLAMA_MODEL || 'llama3.2:3b';

const MAX_MESSAGES      = 40;
const MAX_MESSAGE_CHARS = 8000;

// ── Sanitize values injected into the system prompt from external sources ────
function sanitizeCtx(val, maxLen = 80) {
  if (val === null || val === undefined) return 'unknown';
  return String(val)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\b(IGNORE|DISREGARD|FORGET|SYSTEM|OVERRIDE|INSTRUCTIONS?)\b/gi, '[filtered]')
    .slice(0, maxLen);
}

// ── Build system prompt — RAG retrieval across all SOC tools ─────────────────
async function buildSystem(useContext, userQuery = '') {
  if (!useContext) {
    return `You are an expert SOC analyst assistant embedded in a security portal.
Be concise and actionable. Reference MITRE ATT&CK techniques when relevant.
Use markdown formatting for clarity.`;
  }

  const sections = [];

  // ── 1. RAG: semantic retrieval from all indexed sources ───────────────────
  try {
    const queryVec = await embed(userQuery || 'security events alerts threats');
    const docs     = await queryDocuments(queryVec, 8);

    if (docs.length) {
      // Group by source so the LLM can reason about provenance
      const bySource = {};
      for (const { text, meta } of docs) {
        const src = meta.source || 'unknown';
        if (!bySource[src]) bySource[src] = [];
        bySource[src].push(text);
      }

      const evidence = Object.entries(bySource)
        .map(([src, items]) => {
          const label = src.toUpperCase().replace('_', ' ');
          return `[${label}]\n${items.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}`;
        })
        .join('\n\n');

      sections.push(`RETRIEVED EVIDENCE — semantic search across Wazuh, Suricata, Zeek, CrowdSec, Docker, Prometheus, OpenCTI:\n${evidence}`);
    } else {
      sections.push('(No relevant events retrieved from the vector index for this query — index may still be warming up)');
    }
  } catch (e) {
    sections.push(`(RAG retrieval unavailable: ${e.message})`);
  }

  // ── 2. Live Wazuh 24h summary as background baseline ─────────────────────
  try {
    const [summary, agents] = await Promise.all([
      wazuh.getAlertsSummary(24),
      wazuh.getAgents(),
    ]);
    const critical  = summary.by_level.filter(b => b.key >= 12).reduce((s, b) => s + b.doc_count, 0);
    const high      = summary.by_level.filter(b => b.key >= 7 && b.key < 12).reduce((s, b) => s + b.doc_count, 0);
    const topGroups = summary.by_group.slice(0, 4).map(b => sanitizeCtx(b.key)).join(', ') || 'none';
    const topAgent  = summary.by_agent[0];
    const active    = agents.filter(a => a.status === 'active').length;

    sections.push(`LIVE WAZUH SUMMARY (last 24h as of ${new Date().toISOString()}):
  Total: ${summary.total} | Critical (L12+): ${critical} | High (L7-11): ${high}
  Active agents: ${active}/${agents.length} | Top categories: ${topGroups}
  Busiest agent: ${topAgent ? `${sanitizeCtx(topAgent.key)} (${topAgent.doc_count} alerts)` : 'none'}`);
  } catch {
    sections.push('(Live Wazuh summary unavailable — Wazuh may still be starting up)');
  }

  return `You are an expert SOC (Security Operations Center) analyst assistant embedded in a security portal.

${sections.join('\n\n')}

ANALYST GUIDELINES:
- Base your answer on the retrieved evidence above when relevant.
- Always cite which tool the information came from (Wazuh, Suricata, Zeek, CrowdSec, Docker, OpenCTI, etc.).
- Reference MITRE ATT&CK techniques (e.g. T1110) when relevant.
- Use markdown formatting — headers, bold, bullet lists — for clarity.
- Be concise and actionable. Analysts are under time pressure.
- If you don't know something or evidence is missing, say so clearly.`;
}

// ── One active stream per user — prevent duplicate connections ───────────────
const activeStreams = new Map();

// ── POST /api/chat/stream — SSE streaming chat ───────────────────────────────
router.post('/stream', auth, async (req, res) => {
  const userId = req.user?.id ?? req.user?.username ?? 'unknown';

  if (activeStreams.has(userId)) {
    return res.status(429).json({ error: 'You already have an active stream. Wait for it to finish.' });
  }
  activeStreams.set(userId, true);
  res.on('close', () => activeStreams.delete(userId));

  const { messages = [], useContext = true } = req.body || {};
  const model = req.body.model || DEF_MODEL;

  if (!Array.isArray(messages))
    return res.status(400).json({ error: 'messages must be an array' });
  if (messages.length > MAX_MESSAGES)
    return res.status(400).json({ error: `Too many messages (max ${MAX_MESSAGES})` });
  if (messages.find(m => typeof m.content === 'string' && m.content.length > MAX_MESSAGE_CHARS))
    return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_CHARS} chars)` });
  if (messages.find(m => !['user', 'assistant'].includes(m.role)))
    return res.status(400).json({ error: 'Invalid message role' });

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const lastUserMsg   = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const systemContent = await buildSystem(useContext, lastUserMsg);
    const ollamaMessages = [
      { role: 'system', content: systemContent },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ];

    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        model,
        messages: ollamaMessages,
        stream  : true,
        options : { temperature: 0.3 },
      }),
      signal: AbortSignal.timeout(300_000),
    });

    if (!ollamaRes.ok) {
      send({ error: `Ollama returned ${ollamaRes.status}` });
      return;
    }

    let lineBuf = '';
    for await (const rawChunk of ollamaRes.body) {
      const raw   = lineBuf + rawChunk.toString('utf8');
      const lines = raw.split('\n');
      lineBuf     = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        let data;
        try { data = JSON.parse(line); } catch { continue; }
        if (data.message?.content) send({ token: data.message.content });
        if (data.done) { send({ done: true }); return; }
      }
    }

    send({ done: true });
  } catch (err) {
    send({ error: err.message });
  } finally {
    res.end();
  }
});

// ── GET /api/chat/models ─────────────────────────────────────────────────────
const EMBED_MODELS = /embed|nomic-embed|all-minilm|mxbai-embed|snowflake-arctic-embed/i;
router.get('/models', auth, async (req, res) => {
  try {
    const r    = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await r.json();
    const all  = data?.models?.map(m => m.name) || [DEF_MODEL];
    res.json(all.filter(m => !EMBED_MODELS.test(m)));
  } catch {
    res.json([DEF_MODEL]);
  }
});

module.exports = router;

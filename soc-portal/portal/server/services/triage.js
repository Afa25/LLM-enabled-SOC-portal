const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const VALID_VERDICTS = new Set(['true_positive', 'false_positive', 'needs_review']);

function buildPrompt(alert, correlated) {
  const rule  = alert.rule  || {};
  const agent = alert.agent || {};

  const groups = [].concat(rule.groups || []).join(', ') || 'none';
  const mitre  = rule.mitre?.technique
    ? [].concat(rule.mitre.technique).join(', ')
    : 'not mapped';

  const correlatedBlock = correlated.length === 0
    ? '  (none)'
    : correlated.slice(0, 10).map(e =>
        `  [${(e.timestamp || '').slice(11, 19)}] L${e?.rule?.level ?? '?'} — ${e?.rule?.description || 'unknown'}`
      ).join('\n');

  return `You are a SOC triage analyst. Analyze the security alert below and respond with ONLY a JSON object — no markdown, no prose outside the JSON.

ALERT:
  Rule        : ${rule.description || 'Unknown'} (Severity Level ${rule.level ?? '?'}/15)
  Agent       : ${agent.name || 'unknown'} (${agent.ip || 'unknown IP'})
  Timestamp   : ${alert.timestamp || 'unknown'}
  Groups      : ${groups}
  MITRE       : ${mitre}

CORRELATED EVENTS on same agent ±5 min (${correlated.length} events):
${correlatedBlock}

Respond with ONLY this JSON — no text before or after:
{"verdict":"true_positive","confidence":85,"explanation":"2-3 sentence explanation of why this is or is not a real threat.","mitre_tactic":"T1234 Technique Name or null","recommended_action":"Specific action the analyst should take now."}

Rules:
- verdict must be exactly one of: "true_positive", "false_positive", "needs_review"
- confidence is an integer 0-100
- mitre_tactic is a string like "T1110 Brute Force" or the literal null`;
}

async function analyzeAlert(alert, correlated = []) {
  const model  = process.env.OLLAMA_MODEL || 'llama3.2:3b';
  const prompt = buildPrompt(alert, correlated);

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({
      model,
      prompt,
      stream : false,
      options: { temperature: 0.1, top_p: 0.9, num_predict: 400 }
    }),
    signal: AbortSignal.timeout(120_000)
  });

  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const raw  = (data.response || '').trim();

  // Pull first {...} block out of the response (model sometimes adds prose)
  const match = raw.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error(`No JSON in Ollama response: ${raw.slice(0, 300)}`);

  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch (e) { throw new Error(`Invalid JSON from Ollama: ${match[0].slice(0, 300)}`); }

  return {
    verdict: VALID_VERDICTS.has(parsed.verdict) ? parsed.verdict : 'needs_review',
    confidence: Math.min(100, Math.max(0, Math.round(Number(parsed.confidence) || 50))),
    explanation: String(parsed.explanation || 'No explanation provided.').slice(0, 1000),
    mitre_tactic: (parsed.mitre_tactic && parsed.mitre_tactic !== 'null')
      ? String(parsed.mitre_tactic).slice(0, 120)
      : null,
    recommended_action: String(parsed.recommended_action || 'Review manually.').slice(0, 600)
  };
}

module.exports = { analyzeAlert };

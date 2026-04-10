const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:3b';

async function listModels() {
  const res  = await fetch(`${OLLAMA_URL}/api/tags`);
  const data = await res.json();
  return data?.models?.map(m => m.name) || [];
}

// ── Shared prompt builder ─────────────────────────────────────
function buildFullPrompt(context, timeframe) {
  const {
    total = 0, by_level = [], by_group = [], by_agent = [],
    by_mitre = [], top_rules = [], over_time = [],
    startDate, endDate, agents = []
  } = context;

  const levelSummary = by_level
    .map(b => `Level ${b.key}: ${b.doc_count} alerts`).join(', ') || 'No data';

  const groupSummary = by_group
    .slice(0, 8).map(b => `${b.key} (${b.doc_count})`).join(', ') || 'None';

  const agentSummary = by_agent
    .slice(0, 5).map(b => `${b.key}: ${b.doc_count} alerts`).join(', ') || 'None';

  const mitreSummary = by_mitre
    .slice(0, 5).map(b => `${b.key} (${b.doc_count})`).join(', ') || 'None detected';

  const topRules = top_rules
    .slice(0, 5).map(b => `"${b.key}" (${b.doc_count} hits)`).join('\n    - ') || 'None';

  const peakHour  = over_time.reduce((a, b) => b.doc_count > (a?.doc_count || 0) ? b : a, null);
  const peakTime  = peakHour ? new Date(peakHour.key_as_string).toLocaleString() : 'N/A';

  const criticalAlerts = by_level.filter(b => b.key >= 12).reduce((s, b) => s + b.doc_count, 0);
  const highAlerts     = by_level.filter(b => b.key >= 7 && b.key < 12).reduce((s, b) => s + b.doc_count, 0);
  const agentCount     = agents.length || by_agent.length;

  return `You are a senior SOC (Security Operations Center) analyst. Write a professional, structured security report based on the following real telemetry data from our Wazuh SIEM.

REPORT TYPE: ${timeframe.toUpperCase()} SOC SECURITY REPORT
PERIOD: ${startDate} to ${endDate}
GENERATED: ${new Date().toISOString()}

═══ TELEMETRY SUMMARY ═══
Total Alerts: ${total}
Critical Alerts (Level 12+): ${criticalAlerts}
High Alerts (Level 7-11): ${highAlerts}
Monitored Endpoints: ${agentCount}
Peak Activity: ${peakTime}

Alert Severity Breakdown: ${levelSummary}
Top Alert Categories: ${groupSummary}
Most Active Endpoints: ${agentSummary}
MITRE ATT&CK Techniques Observed: ${mitreSummary}
Top Triggered Rules:
    - ${topRules}

═══ INSTRUCTIONS ═══
Write a complete, professional ${timeframe} SOC report using the data above. Structure it with these exact sections:

1. EXECUTIVE SUMMARY (3-4 sentences for non-technical leadership)
2. THREAT LANDSCAPE OVERVIEW (overall security posture, trends)
3. ALERT ANALYSIS (severity breakdown, key categories, comparison to expected baseline)
4. TOP INCIDENTS & DETECTIONS (most significant rules and what they indicate)
5. MITRE ATT&CK COVERAGE (observed techniques and their implications)
6. ENDPOINT STATUS (which endpoints generated most alerts and why)
7. KEY FINDINGS (3-5 bullet points — most important takeaways)
8. RECOMMENDED ACTIONS (3-5 concrete, prioritised action items)
9. METRICS DASHBOARD (a clean table of KPIs)
10. CONCLUSION

Use professional security language. Be specific about the numbers from the data. Highlight any anomalies or concerns. Format the output in clean markdown.`;
}

// ── Generate (blocking) ───────────────────────────────────────
async function generateReport(context, timeframe = 'daily', model = OLLAMA_MODEL) {
  const prompt = buildFullPrompt(context, timeframe);

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.3, top_p: 0.9, num_predict: 3000 }
    }),
    signal: AbortSignal.timeout(300_000)
  });

  if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.response || '';
}

// ── Stream (SSE) ──────────────────────────────────────────────
async function streamReport(context, timeframe = 'daily', model = OLLAMA_MODEL, onChunk) {
  const prompt = buildFullPrompt(context, timeframe);

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: true, options: { temperature: 0.3 } }),
    signal: AbortSignal.timeout(300_000)
  });

  for await (const chunk of res.body) {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.response) onChunk(obj.response);
        if (obj.done) return;
      } catch {}
    }
  }
}

module.exports = { generateReport, streamReport, listModels };

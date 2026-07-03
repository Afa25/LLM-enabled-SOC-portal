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
  // Support both old shape (flat) and new shape (from reportCollector)
  const alerts  = context.alerts  || context;
  const agents  = context.agents  || context.agents || [];
  const {
    total = 0, by_level = [], by_group = [], by_agent = [],
    by_mitre = [], top_rules = [], over_time = [],
  } = alerts;
  const { startDate, endDate } = context;
  const crowdsec = context.crowdsec || null;
  const docker   = context.docker   || null;
  const metrics  = context.metrics  || null;

  // ── Wazuh section ──
  const levelSummary = by_level.map(b => `Level ${b.key}: ${b.doc_count}`).join(', ') || 'No data';
  const groupSummary = by_group.slice(0, 8).map(b => `${b.key} (${b.doc_count})`).join(', ') || 'None';
  const agentSummary = by_agent.slice(0, 6).map(b => `${b.key}: ${b.doc_count}`).join(', ') || 'None';
  const mitreSummary = by_mitre.slice(0, 6).map(b => `${b.key} (${b.doc_count})`).join(', ') || 'None detected';
  const topRules     = top_rules.slice(0, 6).map(b => `  - "${b.key}" (${b.doc_count} hits)`).join('\n') || '  - None';
  const peakHour     = over_time.reduce((a, b) => b.doc_count > (a?.doc_count || 0) ? b : a, null);
  const peakTime     = peakHour ? new Date(peakHour.key_as_string).toLocaleString() : 'N/A';
  const criticalAlerts = by_level.filter(b => b.key >= 12).reduce((s, b) => s + b.doc_count, 0);
  const highAlerts     = by_level.filter(b => b.key >= 7 && b.key < 12).reduce((s, b) => s + b.doc_count, 0);
  const activeAgents   = Array.isArray(agents) ? agents.filter(a => a.status === 'active').length : 0;
  const totalAgents    = Array.isArray(agents) ? agents.length : by_agent.length;

  // ── CrowdSec section ──
  let crowdsecSection = 'CrowdSec: data unavailable';
  if (crowdsec) {
    const topBanned = crowdsec.topIPs?.slice(0, 5).map(e => `${e.ip} (${e.count})`).join(', ') || 'none';
    const scenarios = Object.entries(crowdsec.byScenario || {}).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none';
    crowdsecSection = `CrowdSec Threat Prevention:
  Active bans/decisions : ${crowdsec.count}
  By type               : ${Object.entries(crowdsec.byType || {}).map(([k,v]) => `${k}: ${v}`).join(', ') || 'none'}
  Top banned IPs        : ${topBanned}
  Top scenarios         : ${scenarios}`;
  }

  // ── Docker section ──
  let dockerSection = 'Docker: data unavailable';
  if (docker) {
    const issues = docker.unhealthyList?.length
      ? `\n  Unhealthy/down containers: ${docker.unhealthyList.join(', ')}`
      : '';
    dockerSection = `Docker Infrastructure:
  Total containers: ${docker.total} | Running: ${docker.running} | Unhealthy/stopped: ${docker.unhealthy}${issues}`;
  }

  // ── System metrics section ──
  let metricsSection = 'System Metrics: data unavailable';
  if (metrics) {
    metricsSection = `System Resource Utilisation:
  CPU Usage    : ${metrics.cpu}
  Memory Usage : ${metrics.memory}
  Disk Usage   : ${metrics.disk}
  Network Rx   : ${metrics.network?.rxMbps || 'N/A'}
  Network Tx   : ${metrics.network?.txMbps || 'N/A'}`;
  }

  return `You are a senior SOC (Security Operations Center) analyst. Write a professional, structured security report based on the real telemetry data below. Every number you cite must come from this data.

REPORT TYPE: ${timeframe.toUpperCase()} SOC SECURITY REPORT
PERIOD     : ${startDate} to ${endDate}
GENERATED  : ${new Date().toISOString()}

════════════════════════════════════════
SECTION A — WAZUH SIEM
════════════════════════════════════════
Total Alerts      : ${total}
Critical (L12+)   : ${criticalAlerts}
High (L7–11)      : ${highAlerts}
Active Agents     : ${activeAgents} / ${totalAgents}
Peak Activity     : ${peakTime}

Severity Breakdown  : ${levelSummary}
Top Alert Categories: ${groupSummary}
Most Active Endpoints: ${agentSummary}
MITRE ATT&CK Observed: ${mitreSummary}

Top Triggered Rules:
${topRules}

════════════════════════════════════════
SECTION B — NETWORK THREAT PREVENTION
════════════════════════════════════════
${crowdsecSection}

════════════════════════════════════════
SECTION C — INFRASTRUCTURE HEALTH
════════════════════════════════════════
${dockerSection}

${metricsSection}

════════════════════════════════════════
INSTRUCTIONS
════════════════════════════════════════
Write a complete ${timeframe} SOC report using ONLY the data above. Use these sections:

## 1. Executive Summary
3–4 sentences for non-technical leadership. State overall risk posture.

## 2. Threat Landscape
Key threats observed this period, trends, what the alert categories reveal.

## 3. Alert Analysis
Severity breakdown, busiest endpoints, what the top rules indicate about attacker behaviour.

## 4. MITRE ATT&CK Coverage
Map the observed techniques to tactics. Note any tactic chains.

## 5. Network Defence (CrowdSec)
What IPs/behaviours were blocked. Is the volume normal or elevated?

## 6. Infrastructure Status
Container health, resource utilisation. Flag anything concerning.

## 7. Key Findings
5 bullet points — the most actionable takeaways from this period.

## 8. Recommended Actions
5 prioritised, concrete actions the SOC team should take.

## 9. KPI Dashboard
A markdown table: Metric | Value | Status (✅/⚠️/🔴)

## 10. Conclusion
One paragraph. Overall posture and priority for next period.

Format in clean markdown. Be specific about numbers. If a data source shows N/A, note it as unavailable rather than omitting the section.`;
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

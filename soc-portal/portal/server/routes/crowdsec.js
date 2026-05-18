const express = require('express');
const fetch   = (...a) => import('node-fetch').then(({ default: f }) => f(...a));
const { auth } = require('./auth');
const router  = express.Router();

const CS_URL      = process.env.CROWDSEC_URL     || 'http://crowdsec:8080';
const CS_KEY      = process.env.CROWDSEC_API_KEY || '';
const CS_METRICS  = process.env.CROWDSEC_METRICS_URL || 'http://crowdsec:6060';

function csHeaders() {
  return { 'X-Api-Key': CS_KEY, 'Content-Type': 'application/json' };
}

async function csGet(path) {
  const res = await fetch(`${CS_URL}${path}`, { headers: csHeaders() });
  if (!res.ok) throw new Error(`CrowdSec ${path} → ${res.status}`);
  return res.json();
}

// Parse a Prometheus metrics text body into a flat key→value map
function parseMetrics(text) {
  const out = {};
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    const spaceIdx = line.lastIndexOf(' ');
    const key = line.slice(0, spaceIdx).trim();
    const val = parseFloat(line.slice(spaceIdx).trim());
    out[key] = val;
  }
  return out;
}

function sumMetric(metrics, prefix) {
  return Object.entries(metrics)
    .filter(([k]) => k.startsWith(prefix))
    .reduce((s, [, v]) => s + v, 0);
}

// GET /api/crowdsec/summary
router.get('/summary', auth, async (req, res) => {
  try {
    const [decisionsRes, metricsRes] = await Promise.allSettled([
      csGet('/v1/decisions?limit=500'),
      fetch(`${CS_METRICS}/metrics`).then(r => r.text()),
    ]);

    const decisions = Array.isArray(decisionsRes.value) ? decisionsRes.value : [];
    const metrics   = decisionsRes.status === 'rejected' ? {} :
                      (metricsRes.status === 'fulfilled' ? parseMetrics(metricsRes.value) : {});

    const alertsTotal   = sumMetric(metrics, 'cs_lapi_request_duration_seconds_count{endpoint="/v1/alerts"');
    const machinesTotal = sumMetric(metrics, 'cs_lapi_machine_requests_total');
    const bouncersTotal = sumMetric(metrics, 'cs_lapi_bouncer_requests_total');

    // Count unique machines/bouncers from metric labels
    const machines = new Set();
    const bouncers = new Set();
    if (metricsRes.status === 'fulfilled') {
      for (const line of metricsRes.value.split('\n')) {
        const mm = line.match(/cs_lapi_machine_requests_total\{machine="([^"]+)"/);
        if (mm) machines.add(mm[1]);
        const bm = line.match(/cs_lapi_bouncer_requests_total\{bouncer="([^"]+)"/);
        if (bm) bouncers.add(bm[1]);
      }
    }

    const nginxHits = metrics['cs_dockersource_hits_total{acquis_type="nginx",datasource_type="docker",source="soc-nginx"}'] || 0;

    res.json({
      active_decisions: decisions.length,
      nginx_lines_read: nginxHits,
      machines:         machines.size,
      bouncers:         bouncers.size,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crowdsec/decisions
router.get('/decisions', auth, async (req, res) => {
  try {
    const data = await csGet('/v1/decisions?limit=100');
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crowdsec/alerts — returns parsed alert metrics per scenario
router.get('/alerts', auth, async (req, res) => {
  try {
    const text    = await fetch(`${CS_METRICS}/metrics`).then(r => r.text());
    const alerts  = [];
    for (const line of text.split('\n')) {
      // cs_lapi_alerts_total{reason="...",origin="...",action="..."} N
      const m = line.match(/cs_lapi_alerts_total\{([^}]+)\}\s+([\d.]+)/);
      if (!m) continue;
      const labels = {};
      for (const [, k, v] of m[1].matchAll(/(\w+)="([^"]+)"/g)) labels[k] = v;
      alerts.push({ ...labels, count: parseFloat(m[2]) });
    }
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/crowdsec/metrics — raw Prometheus metrics for the frontend
router.get('/metrics', auth, async (req, res) => {
  try {
    const text = await fetch(`${CS_METRICS}/metrics`).then(r => r.text());
    const metrics = parseMetrics(text);
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

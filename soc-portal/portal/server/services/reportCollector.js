/**
 * reportCollector.js — Parallel data gatherer for SOC reports.
 *
 * Collects from all available sources simultaneously, fails gracefully
 * if any source is down. No LLM involvement — pure data gathering.
 */

const fetch  = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const wazuh  = require('./wazuh');
const monitor = require('./containerMonitor');

const CS_URL      = process.env.CROWDSEC_URL     || 'http://crowdsec:8080';
const CS_KEY      = process.env.CROWDSEC_API_KEY || '';
const PROM_URL    = process.env.PROMETHEUS_URL   || 'http://prometheus:9090';
const TIMEOUT_MS  = 10_000;

// Resolve a promise with a fallback if it takes too long or rejects
async function safe(promise, fallback = null) {
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS)),
    ]);
  } catch {
    return fallback;
  }
}

// ── CrowdSec ─────────────────────────────────────────────────────────────────
async function getCrowdSec() {
  const res = await fetch(`${CS_URL}/v1/decisions?limit=500`, {
    headers: { 'X-Api-Key': CS_KEY, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const decisions = await res.json();
  if (!Array.isArray(decisions) || decisions.length === 0) return { count: 0, byType: {}, byScenario: {}, topIPs: [] };

  const byType     = {};
  const byScenario = {};
  for (const d of decisions) {
    byType[d.type]         = (byType[d.type]         || 0) + 1;
    byScenario[d.scenario] = (byScenario[d.scenario] || 0) + 1;
  }

  const topIPs = Object.entries(
    decisions.reduce((acc, d) => { acc[d.value] = (acc[d.value] || 0) + 1; return acc; }, {})
  ).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([ip, count]) => ({ ip, count }));

  return { count: decisions.length, byType, byScenario, topIPs };
}

// ── Docker containers ─────────────────────────────────────────────────────────
function getDocker() {
  const raw = monitor.getStatus();
  const containers = Object.values(raw);
  if (!containers.length) return null;

  const running   = containers.filter(c => c.status?.startsWith('Up'));
  const unhealthy = containers.filter(c => /unhealthy|Exit/i.test(c.status || ''));

  return {
    total:     containers.length,
    running:   running.length,
    unhealthy: unhealthy.length,
    down:      containers.length - running.length,
    unhealthyList: unhealthy.map(c => c.name || c.Names).filter(Boolean),
  };
}

// ── Prometheus ────────────────────────────────────────────────────────────────
async function promQuery(q) {
  const res = await fetch(
    `${PROM_URL}/api/v1/query?query=${encodeURIComponent(q)}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const v = data?.data?.result?.[0]?.value?.[1];
  return v != null ? parseFloat(v) : null;
}

async function getSystemMetrics() {
  const [cpuIdle, memAvail, memTotal, diskAvail, diskTotal, netRx, netTx] = await Promise.all([
    promQuery('100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'),
    promQuery('node_memory_MemAvailable_bytes'),
    promQuery('node_memory_MemTotal_bytes'),
    promQuery('node_filesystem_avail_bytes{mountpoint="/"}'),
    promQuery('node_filesystem_size_bytes{mountpoint="/"}'),
    promQuery('sum(rate(node_network_receive_bytes_total[5m])) * 8'),
    promQuery('sum(rate(node_network_transmit_bytes_total[5m])) * 8'),
  ]);

  const fmt = (v, unit = '%', dec = 1) => v != null ? `${v.toFixed(dec)} ${unit}` : 'N/A';
  const pct  = (used, total) => total ? ((used / total) * 100).toFixed(1) + '%' : 'N/A';
  const mbps = bps => bps != null ? `${(bps / 1_000_000).toFixed(2)} Mbps` : 'N/A';

  return {
    cpu:    fmt(cpuIdle),
    memory: memAvail != null && memTotal != null
              ? pct(memTotal - memAvail, memTotal) + ` (${((memTotal - memAvail) / 1e9).toFixed(1)} GB used)`
              : 'N/A',
    disk:   diskAvail != null && diskTotal != null
              ? pct(diskTotal - diskAvail, diskTotal) + ` (${((diskTotal - diskAvail) / 1e9).toFixed(1)} GB used / ${(diskTotal / 1e9).toFixed(1)} GB total)`
              : 'N/A',
    network: {
      rxMbps: mbps(netRx),
      txMbps: mbps(netTx),
    },
  };
}

// ── Wazuh active critical alerts ──────────────────────────────────────────────
async function getRecentCritical(startISO, endISO) {
  try {
    const data = await wazuh.getAlertCountByRange(startISO, endISO);
    return data;
  } catch {
    return { total: 0, by_level: [], by_group: [], by_agent: [], by_mitre: [], top_rules: [], over_time: [] };
  }
}

// ── Main collector ─────────────────────────────────────────────────────────────
async function collectAll(startISO, endISO) {
  const [alerts, agents, crowdsec, metrics] = await Promise.all([
    safe(getRecentCritical(startISO, endISO), { total: 0, by_level: [], by_group: [], by_agent: [], by_mitre: [], top_rules: [], over_time: [] }),
    safe(wazuh.getAgents(), []),
    safe(getCrowdSec(), null),
    safe(getSystemMetrics(), null),
  ]);

  // containerMonitor is sync (in-memory cache), no timeout needed
  const docker = getDocker();

  return { alerts, agents, crowdsec, docker, metrics, startDate: startISO, endDate: endISO };
}

module.exports = { collectAll };

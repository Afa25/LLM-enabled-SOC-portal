const fs = require('fs');
const path = require('path');
const wazuh = require('./wazuh');

const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const PROM_URL = process.env.PROMETHEUS_URL || 'http://prometheus:9090';
const AUTOSYNC = (process.env.SNMP_AUTOSYNC || 'true').toLowerCase() === 'true';
const INTERVAL = parseInt(process.env.SNMP_SYNC_INTERVAL_MS || '300000', 10);
const TARGETS_PATH = process.env.SNMP_TARGETS_PATH || '/app/config/snmp_targets.auto.yml';

async function queryProm(query) {
  const url = new URL('/api/v1/query', PROM_URL);
  url.searchParams.set('query', query);
  const res = await fetch(url.toString());
  const data = await res.json();
  return data?.data?.result || [];
}

async function getEndpointHealth() {
  const up = await queryProm('up{job="snmp-endpoints"}');
  const scrape = await queryProm('scrape_duration_seconds{job="snmp-endpoints"}');

  const scrapeMap = new Map();
  scrape.forEach(r => {
    const instance = r.metric?.instance;
    if (instance) scrapeMap.set(instance, parseFloat(r.value?.[1] || '0'));
  });

  return up.map(r => ({
    instance: r.metric?.instance || 'unknown',
    status: parseFloat(r.value?.[1] || '0') === 1 ? 'up' : 'down',
    scrape_seconds: scrapeMap.get(r.metric?.instance) || 0
  }));
}

function writeTargets(ipList) {
  const unique = Array.from(new Set(ipList)).sort();
  const lines = [];
  lines.push('- targets:');
  if (unique.length === 0) {
    lines.push('  - 0.0.0.0');
  } else {
    unique.forEach(ip => lines.push(`  - ${ip}`));
  }
  lines.push('  labels:');
  lines.push('    job: snmp-endpoints');

  const dir = path.dirname(TARGETS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TARGETS_PATH, lines.join('\n') + '\n', 'utf-8');
}

async function syncSnmpTargets() {
  if (!AUTOSYNC) return;
  try {
    const agents = await wazuh.getAgents();
    const ips = agents
      .map(a => a.ip)
      .filter(Boolean)
      .map(ip => (Array.isArray(ip) ? ip[0] : ip))
      .filter(ip => ip && ip !== '127.0.0.1' && ip !== '0.0.0.0');

    writeTargets(ips);
  } catch (err) {
    console.error('[SNMP] Sync error:', err.message);
  }
}

function startSnmpSync() {
  if (!AUTOSYNC) return;
  syncSnmpTargets();
  setInterval(syncSnmpTargets, INTERVAL);
}

module.exports = { getEndpointHealth, startSnmpSync, syncSnmpTargets };

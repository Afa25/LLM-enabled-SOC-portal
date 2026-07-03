/**
 * ragIndexer.js — Multi-source RAG indexer for all SOC tools.
 *
 * Sources indexed:
 *   1. Wazuh    — SIEM alerts via OpenSearch API
 *   2. Suricata — IDS alerts from /data/suricata/eve.json
 *   3. Zeek     — Network logs from /data/zeek/ (notice, dns, http)
 *   4. CrowdSec — Blocked IPs and decisions via HTTP API
 *   5. Docker   — Container health from containerMonitor
 *   6. Prometheus — CPU/memory/disk snapshot via PromQL
 *   7. OpenCTI  — Threat intelligence indicators via GraphQL
 *
 * Runs on server start and every 5 minutes. All sources run in
 * parallel; individual failures are silently swallowed so one
 * unavailable service never blocks the others.
 */

const fs      = require('fs');
const path    = require('path');
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const wazuh   = require('./wazuh');
const monitor = require('./containerMonitor');
const { embed }            = require('./embeddings');
const { ensureCollection, upsertDocuments } = require('./vectorStore');

const CS_URL        = process.env.CROWDSEC_URL     || 'http://crowdsec:8080';
const CS_KEY        = process.env.CROWDSEC_API_KEY || '';
const PROM_URL      = process.env.PROMETHEUS_URL   || 'http://prometheus:9090';
const OPENCTI_URL   = process.env.OPENCTI_URL      || 'http://opencti:8080/opencti';
const OPENCTI_TOKEN = process.env.OPENCTI_TOKEN    || '';

const SURICATA_EVE = '/data/suricata/eve.json';
const ZEEK_DIR     = '/data/zeek';

// ── Utilities ─────────────────────────────────────────────────────

async function safe(fn, label) {
  try { return await fn(); }
  catch (e) { console.warn(`[RAG:${label}] ${e.message}`); return 0; }
}

// Read last maxLines from a potentially large file without loading all of it
function readLastLines(filePath, maxLines = 200) {
  if (!fs.existsSync(filePath)) return [];
  const CHUNK = 65536;
  const fd    = fs.openSync(filePath, 'r');
  const stat  = fs.fstatSync(fd);
  let   pos   = stat.size;
  let   buf   = '';
  const lines = [];

  while (pos > 0 && lines.length < maxLines) {
    const size  = Math.min(CHUNK, pos);
    pos        -= size;
    const chunk = Buffer.alloc(size);
    fs.readSync(fd, chunk, 0, size, pos);
    buf = chunk.toString('utf8') + buf;
    const parts = buf.split('\n');
    buf = parts.shift();
    lines.unshift(...parts.filter(Boolean));
  }
  if (buf.trim()) lines.unshift(buf.trim());
  fs.closeSync(fd);
  return lines.slice(-maxLines);
}

// Stable deterministic ID for ChromaDB upsert idempotency
function docId(source, key) {
  return `${source}:${String(key).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)}`;
}

// Embed and batch-upsert a list of { id, text, meta } objects
async function batchIndex(items) {
  if (!items.length) return 0;
  const ids = [], embeddings = [], documents = [], metadatas = [];
  for (const item of items) {
    ids.push(item.id);
    embeddings.push(await embed(item.text));
    documents.push(item.text);
    metadatas.push(item.meta);
  }
  await upsertDocuments(ids, embeddings, documents, metadatas);
  return items.length;
}

const FIFTEEN_MIN = 15 * 60_000;

// ── 1. Wazuh SIEM alerts ──────────────────────────────────────────
async function indexWazuh() {
  const now   = new Date();
  const from  = new Date(now - FIFTEEN_MIN).toISOString();
  const alerts = await wazuh.getAlerts({ limit: 60, from, to: now.toISOString() });
  if (!alerts.length) return 0;

  return batchIndex(alerts.map(a => ({
    id:   docId('wazuh', a._id || `${a.timestamp}${a.rule?.id}`),
    text: [
      'Source: Wazuh SIEM',
      `Rule: ${a.rule?.description || 'unknown'}`,
      `Level: ${a.rule?.level}`,
      `Agent: ${a.agent?.name || 'unknown'} (${a.agent?.ip || 'unknown'})`,
      `Groups: ${(a.rule?.groups || []).join(', ') || 'none'}`,
      `MITRE: ${a.rule?.mitre?.technique?.join(', ') || 'none'}`,
      `Time: ${a.timestamp}`,
    ].join(' | '),
    meta: {
      source:    'wazuh',
      level:     String(a.rule?.level || 0),
      timestamp: a.timestamp || '',
      agent:     a.agent?.name || '',
    },
  })));
}

// ── 2. Suricata IDS alerts ────────────────────────────────────────
async function indexSuricata() {
  const lines  = readLastLines(SURICATA_EVE, 400);
  const cutoff = Date.now() - FIFTEEN_MIN;

  const items = [];
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.event_type !== 'alert') continue;
    try { if (new Date(e.timestamp).getTime() < cutoff) continue; } catch {}

    items.push({
      id:   docId('suricata', e.flow_id || e.timestamp),
      text: [
        'Source: Suricata IDS',
        `Alert: ${e.alert?.signature || 'unknown'}`,
        `Category: ${e.alert?.category || 'unknown'}`,
        `Severity: ${e.alert?.severity}`,
        `Src: ${e.src_ip}:${e.src_port} → Dst: ${e.dest_ip}:${e.dest_port}`,
        `Proto: ${e.proto}`,
        `Time: ${e.timestamp}`,
      ].join(' | '),
      meta: {
        source:    'suricata',
        severity:  String(e.alert?.severity || 0),
        timestamp: e.timestamp || '',
        src_ip:    e.src_ip || '',
      },
    });
  }
  return batchIndex(items);
}

// ── 3. Zeek network logs ──────────────────────────────────────────
async function indexZeek() {
  // Prefer current/ directory; fall back to today's date dir
  const candidates = [
    path.join(ZEEK_DIR, 'current'),
    path.join(ZEEK_DIR, new Date().toISOString().slice(0, 10)),
    ZEEK_DIR,
  ];
  const logDir = candidates.find(d => {
    try { return fs.statSync(d).isDirectory(); } catch { return false; }
  });
  if (!logDir) return 0;

  const cutoff = Date.now() - FIFTEEN_MIN;
  const items  = [];

  const logTypes = {
    notice: { file: 'notice.log', toText: e => `Notice: ${e.note || 'unknown'} | Msg: ${e.msg || ''} | Src: ${e.src || ''} | Dst: ${e.dst || ''}` },
    dns:    { file: 'dns.log',    toText: e => `Query: ${e.query || ''} | Type: ${e.qtype_name || ''} | Answers: ${(e.answers || []).join(', ')} | Src: ${e.id?.orig_h || ''}` },
    http:   { file: 'http.log',   toText: e => `Method: ${e.method || ''} | Host: ${e.host || ''} | URI: ${(e.uri || '').slice(0, 100)} | Status: ${e.status_code || ''} | Src: ${e.id?.orig_h || ''}` },
  };

  for (const [type, cfg] of Object.entries(logTypes)) {
    const filePath = path.join(logDir, cfg.file);
    for (const line of readLastLines(filePath, 100)) {
      if (line.startsWith('#')) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      // Zeek ts is epoch float
      if (e.ts && e.ts * 1000 < cutoff) continue;

      items.push({
        id:   docId(`zeek_${type}`, `${e.ts}_${e.uid || Math.random()}`),
        text: `Source: Zeek ${type.toUpperCase()} | Time: ${e.ts || 'unknown'} | ${cfg.toText(e)}`,
        meta: {
          source:    `zeek_${type}`,
          timestamp: String(e.ts || ''),
          src_ip:    e.id?.orig_h || e.src || '',
        },
      });
    }
  }
  return batchIndex(items);
}

// ── 4. CrowdSec decisions ─────────────────────────────────────────
async function indexCrowdSec() {
  const res = await fetch(`${CS_URL}/v1/decisions?limit=100`, {
    headers: { 'X-Api-Key': CS_KEY },
    signal:  AbortSignal.timeout(10_000),
  });
  if (!res.ok) return 0;
  const decisions = await res.json();
  if (!Array.isArray(decisions) || !decisions.length) return 0;

  return batchIndex(decisions.map(d => ({
    id:   docId('crowdsec', d.id || d.value),
    text: [
      'Source: CrowdSec',
      `Action: ${d.type} on ${d.scope} ${d.value}`,
      `Scenario: ${d.scenario}`,
      `Origin: ${d.origin}`,
      `Duration: ${d.duration}`,
    ].join(' | '),
    meta: {
      source:   'crowdsec',
      action:   d.type     || '',
      scenario: d.scenario || '',
      ip:       d.value    || '',
    },
  })));
}

// ── 5. Docker container health ────────────────────────────────────
async function indexDocker() {
  const raw        = monitor.getStatus();
  const containers = Object.values(raw);
  if (!containers.length) return 0;

  // Index all unhealthy/down containers + a sample of healthy ones
  const unhealthy = containers.filter(c => /unhealthy|Exit/i.test(c.status || ''));
  const healthy   = containers.filter(c => !/unhealthy|Exit/i.test(c.status || '')).slice(0, 8);

  return batchIndex([...unhealthy, ...healthy].map(c => ({
    id:   docId('docker', c.name || c.Names || JSON.stringify(c)),
    text: [
      'Source: Docker Infrastructure',
      `Container: ${c.name || c.Names || 'unknown'}`,
      `Status: ${c.status || c.Status || 'unknown'}`,
      `Image: ${c.image || c.Image || 'unknown'}`,
    ].join(' | '),
    meta: {
      source: 'docker',
      status: c.status || c.Status || '',
      name:   c.name   || c.Names  || '',
    },
  })));
}

// ── 6. Prometheus system metrics ──────────────────────────────────
async function indexPrometheus() {
  const queries = {
    cpu:    '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
    memory: '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100',
    disk:   '(1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})) * 100',
    net_rx: 'sum(rate(node_network_receive_bytes_total[5m])) * 8 / 1e6',
    net_tx: 'sum(rate(node_network_transmit_bytes_total[5m])) * 8 / 1e6',
  };

  const values = {};
  await Promise.all(Object.entries(queries).map(async ([name, q]) => {
    try {
      const r    = await fetch(`${PROM_URL}/api/v1/query?query=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8_000) });
      const data = await r.json();
      const v    = data?.data?.result?.[0]?.value?.[1];
      if (v != null) values[name] = parseFloat(v).toFixed(1);
    } catch {}
  }));

  if (!Object.keys(values).length) return 0;

  const text = [
    'Source: Prometheus System Metrics',
    `CPU: ${values.cpu ?? 'N/A'}%`,
    `Memory: ${values.memory ?? 'N/A'}%`,
    `Disk: ${values.disk ?? 'N/A'}%`,
    `Network Rx: ${values.net_rx ?? 'N/A'} Mbps`,
    `Network Tx: ${values.net_tx ?? 'N/A'} Mbps`,
    `Snapshot: ${new Date().toISOString()}`,
  ].join(' | ');

  await upsertDocuments(
    [docId('prometheus', 'system_snapshot')],
    [await embed(text)],
    [text],
    [{ source: 'prometheus', timestamp: new Date().toISOString() }]
  );
  return 1;
}

// ── 7. OpenCTI threat intelligence ───────────────────────────────
async function indexOpenCTI() {
  if (!OPENCTI_TOKEN) return 0;

  const query = `query {
    stixCyberObservables(first: 30, orderBy: created_at, orderMode: desc) {
      edges {
        node {
          id entity_type observable_value created_at
          ... on Indicator { name description }
        }
      }
    }
  }`;

  const res = await fetch(`${OPENCTI_URL}/graphql`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENCTI_TOKEN}` },
    body:    JSON.stringify({ query }),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) return 0;

  const data  = await res.json();
  const edges = data?.data?.stixCyberObservables?.edges || [];
  if (!edges.length) return 0;

  return batchIndex(edges.map(({ node: n }) => ({
    id:   docId('opencti', n.id),
    text: [
      'Source: OpenCTI Threat Intelligence',
      `Type: ${n.entity_type}`,
      `Value: ${n.observable_value || n.name || 'unknown'}`,
      `Description: ${(n.description || '').slice(0, 200)}`,
      `Created: ${n.created_at}`,
    ].join(' | '),
    meta: {
      source:  'opencti',
      type:    n.entity_type || '',
      created: n.created_at  || '',
    },
  })));
}

// ── Main cycle ────────────────────────────────────────────────────
async function runIndexing() {
  await ensureCollection();

  const [w, sur, z, cs, dok, prom, octi] = await Promise.all([
    safe(indexWazuh,     'Wazuh'),
    safe(indexSuricata,  'Suricata'),
    safe(indexZeek,      'Zeek'),
    safe(indexCrowdSec,  'CrowdSec'),
    safe(indexDocker,    'Docker'),
    safe(indexPrometheus,'Prometheus'),
    safe(indexOpenCTI,   'OpenCTI'),
  ]);

  console.log(`[RAG] Index cycle complete — Wazuh:${w} Suricata:${sur} Zeek:${z} CrowdSec:${cs} Docker:${dok} Prometheus:${prom} OpenCTI:${octi}`);
}

// Run immediately on server start, then every 5 minutes
runIndexing().catch(e => console.error('[RAG] Startup index failed:', e.message));
setInterval(
  () => runIndexing().catch(e => console.error('[RAG] Index cycle failed:', e.message)),
  5 * 60_000
);

module.exports = { runIndexing };

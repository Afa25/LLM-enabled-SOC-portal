const express = require('express');
const fs      = require('fs');
const path    = require('path');
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const { auth } = require('./auth');

const router = express.Router();

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://prometheus:9090';
const SURICATA_LOG   = process.env.SURICATA_LOG   || '/data/suricata/eve.json';
const ZEEK_LOG_DIR   = process.env.ZEEK_LOG_DIR   || '/data/zeek';

// ── GET /api/netdata/prometheus ───────────────────────────────
router.get('/prometheus', auth, async (req, res) => {
  const queries = {
    cpu_pct:    '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
    mem_pct:    '(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100',
    disk_pct:   '(1 - node_filesystem_avail_bytes{fstype!="tmpfs",mountpoint="/"} / node_filesystem_size_bytes{fstype!="tmpfs",mountpoint="/"}) * 100',
    net_rx_kbs: 'sum(rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*"}[5m])) / 1024',
    net_tx_kbs: 'sum(rate(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*"}[5m])) / 1024',
    uptime_s:   'node_time_seconds - node_boot_time_seconds',
  };
  const results = {};
  try {
    await Promise.all(
      Object.entries(queries).map(async ([key, q]) => {
        try {
          const r = await fetch(
            `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(q)}`,
            { signal: AbortSignal.timeout(5000) }
          );
          const body = await r.json();
          const val  = body?.data?.result?.[0]?.value?.[1];
          results[key] = val != null ? parseFloat(parseFloat(val).toFixed(1)) : null;
        } catch {
          results[key] = null;
        }
      })
    );
    res.json({ available: true, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Shared helpers ────────────────────────────────────────────
const MAX_LOG_BYTES = 50 * 1024 * 1024;

function readTailBytes(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  if (stat.size <= maxBytes) return fs.readFileSync(filePath, 'utf8');
  const fd  = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(maxBytes);
  fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
  fs.closeSync(fd);
  return buf.toString('utf8');
}

// ── Zeek log parser — handles both JSON and TSV formats ───────
// local.zeek uses @load tuning/json-logs so each line is JSON.
// Fall back to TSV (#fields header) if JSON parse fails.
function parseZeekLines(lines) {
  const dataLines = lines.filter(l => l && !l.startsWith('#'));
  if (!dataLines.length) return [];

  // Detect format by trying to JSON-parse the first data line
  let isJson = false;
  try {
    const probe = JSON.parse(dataLines[0]);
    if (probe['id.orig_h'] !== undefined || probe._path !== undefined) isJson = true;
  } catch {}

  if (isJson) {
    return dataLines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(o => o && (o['id.orig_h'] || o._path === 'conn'))
      .map(o => ({
        ts:        o.ts,
        src_ip:    o['id.orig_h'],
        src_port:  o['id.orig_p'],
        dest_ip:   o['id.resp_h'],
        dest_port: o['id.resp_p'],
        proto:     o.proto,
        service:   o.service,
        duration:  o.duration != null ? parseFloat(o.duration).toFixed(3) : null,
        bytes_in:  o.orig_bytes != null ? parseInt(o.orig_bytes) : null,
        bytes_out: o.resp_bytes != null ? parseInt(o.resp_bytes) : null,
      }));
  }

  // TSV fallback
  let fields = [];
  const conns = [];
  for (const line of lines) {
    if (line.startsWith('#fields\t')) {
      fields = line.slice('#fields\t'.length).split('\t');
      continue;
    }
    if (line.startsWith('#') || !fields.length) continue;
    const parts = line.split('\t');
    if (parts.length < fields.length) continue;
    const obj = {};
    fields.forEach((f, i) => { obj[f] = parts[i]; });
    conns.push({
      ts:        obj.ts,
      src_ip:    obj['id.orig_h'],
      src_port:  obj['id.orig_p'],
      dest_ip:   obj['id.resp_h'],
      dest_port: obj['id.resp_p'],
      proto:     obj.proto,
      service:   obj.service,
      duration:  obj.duration && obj.duration !== '-' ? parseFloat(obj.duration).toFixed(3) : null,
      bytes_in:  obj['orig_bytes'] !== '-' ? parseInt(obj['orig_bytes']) : null,
      bytes_out: obj['resp_bytes'] !== '-' ? parseInt(obj['resp_bytes']) : null,
    });
  }
  return conns;
}

function findZeekLog() {
  const candidates = [
    path.join(ZEEK_LOG_DIR, 'current', 'conn.log'),
    path.join(ZEEK_LOG_DIR, 'conn.log'),
  ];
  return candidates.find(f => { try { return fs.existsSync(f); } catch { return false; } }) || null;
}

function parseZeekFile(maxLines = 2000) {
  const logFile = findZeekLog();
  if (!logFile) return null;
  const lines = readTailBytes(logFile, MAX_LOG_BYTES).trim().split('\n');
  return parseZeekLines(lines.slice(-maxLines));
}

function parseSuricataFile(maxLines = 2000) {
  if (!fs.existsSync(SURICATA_LOG)) return null;
  const raw = readTailBytes(SURICATA_LOG, MAX_LOG_BYTES).trim().split('\n');
  return raw
    .slice(-maxLines)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(e => e && e.event_type === 'alert');
}

// ── GET /api/netdata/suricata ─────────────────────────────────
router.get('/suricata', auth, (req, res) => {
  try {
    const events = parseSuricataFile(500);
    if (events === null) return res.json({ available: false, alerts: [] });

    const alerts = events.slice(-50).reverse().map(e => ({
      timestamp: e.timestamp,
      src_ip:    e.src_ip,
      dest_ip:   e.dest_ip,
      proto:     e.proto,
      signature: e.alert?.signature,
      severity:  e.alert?.severity,
      category:  e.alert?.category,
    }));
    res.json({ available: true, alerts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/netdata/zeek ─────────────────────────────────────
router.get('/zeek', auth, (req, res) => {
  try {
    const conns = parseZeekFile(1000);
    if (conns === null) return res.json({ available: false, connections: [] });
    res.json({ available: true, connections: conns.slice(-50).reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/netdata/ids-stats ────────────────────────────────
// Rich summary for the dashboard: top protocols, IPs, severity breakdown
router.get('/ids-stats', auth, (req, res) => {
  const result = { zeek: null, suricata: null };

  // ── Zeek summary ─────────────────────────────────────────
  try {
    const conns = parseZeekFile(2000);
    if (conns !== null) {
      const byProto   = {};
      const bySvc     = {};
      const srcIpCount = {};
      let bytesIn = 0, bytesOut = 0;

      for (const c of conns) {
        if (c.proto)    byProto[c.proto] = (byProto[c.proto] || 0) + 1;
        const svc = (c.service && c.service !== '-') ? c.service : 'unknown';
        bySvc[svc] = (bySvc[svc] || 0) + 1;
        if (c.src_ip)   srcIpCount[c.src_ip] = (srcIpCount[c.src_ip] || 0) + 1;
        if (c.bytes_in  != null) bytesIn  += c.bytes_in;
        if (c.bytes_out != null) bytesOut += c.bytes_out;
      }

      const topSrcIps = Object.entries(srcIpCount)
        .sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([ip, count]) => ({ ip, count }));

      result.zeek = {
        available:    true,
        total:        conns.length,
        unique_src:   Object.keys(srcIpCount).length,
        bytes_in:     bytesIn,
        bytes_out:    bytesOut,
        by_proto:     byProto,
        by_service:   bySvc,
        top_src_ips:  topSrcIps,
      };
    } else {
      result.zeek = { available: false };
    }
  } catch {
    result.zeek = { available: false };
  }

  // ── Suricata summary ──────────────────────────────────────
  try {
    const events = parseSuricataFile(2000);
    if (events !== null) {
      const bySeverity = { 1: 0, 2: 0, 3: 0 };
      const byCategory = {};
      const srcIpCount = {};

      for (const e of events) {
        const sev = e.alert?.severity;
        if (sev >= 1 && sev <= 3) bySeverity[sev]++;
        const cat = e.alert?.category || 'Unknown';
        byCategory[cat] = (byCategory[cat] || 0) + 1;
        if (e.src_ip) srcIpCount[e.src_ip] = (srcIpCount[e.src_ip] || 0) + 1;
      }

      const topCategories = Object.entries(byCategory)
        .sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([cat, count]) => ({ cat, count }));

      const topSrcIps = Object.entries(srcIpCount)
        .sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([ip, count]) => ({ ip, count }));

      result.suricata = {
        available:      true,
        total:          events.length,
        by_severity:    bySeverity,
        by_category:    byCategory,
        top_categories: topCategories,
        top_src_ips:    topSrcIps,
      };
    } else {
      result.suricata = { available: false };
    }
  } catch {
    result.suricata = { available: false };
  }

  res.json(result);
});

// ── GET /api/netdata/ids-metrics ──────────────────────────────
// Prometheus text-format metrics — scraped by Prometheus, shown in Grafana.
// No auth: Prometheus needs to scrape this without a token.
router.get('/ids-metrics', (req, res) => {
  const lines = [];

  const emit = (name, labels, value) => {
    const lblStr = labels
      ? '{' + Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(',') + '}'
      : '';
    lines.push(`${name}${lblStr} ${value}`);
  };

  // Zeek
  try {
    const conns = parseZeekFile(2000);
    const avail = conns !== null ? 1 : 0;
    lines.push('# HELP soc_ids_zeek_available 1 if Zeek conn.log is present');
    lines.push('# TYPE soc_ids_zeek_available gauge');
    emit('soc_ids_zeek_available', null, avail);

    if (conns) {
      const byProto = {};
      let bytesIn = 0, bytesOut = 0;
      for (const c of conns) {
        if (c.proto) byProto[c.proto] = (byProto[c.proto] || 0) + 1;
        if (c.bytes_in  != null) bytesIn  += c.bytes_in;
        if (c.bytes_out != null) bytesOut += c.bytes_out;
      }
      lines.push('# HELP soc_ids_zeek_connections_parsed Connections in current log window');
      lines.push('# TYPE soc_ids_zeek_connections_parsed gauge');
      emit('soc_ids_zeek_connections_parsed', null, conns.length);

      lines.push('# HELP soc_ids_zeek_bytes_total Bytes transferred in current log window');
      lines.push('# TYPE soc_ids_zeek_bytes_total gauge');
      emit('soc_ids_zeek_bytes_total', { direction: 'inbound'  }, bytesIn);
      emit('soc_ids_zeek_bytes_total', { direction: 'outbound' }, bytesOut);

      lines.push('# HELP soc_ids_zeek_connections_proto Connections by protocol');
      lines.push('# TYPE soc_ids_zeek_connections_proto gauge');
      for (const [proto, count] of Object.entries(byProto)) {
        emit('soc_ids_zeek_connections_proto', { proto }, count);
      }
    }
  } catch {}

  // Suricata
  try {
    const events = parseSuricataFile(2000);
    const avail = events !== null ? 1 : 0;
    lines.push('# HELP soc_ids_suricata_available 1 if Suricata eve.json is present');
    lines.push('# TYPE soc_ids_suricata_available gauge');
    emit('soc_ids_suricata_available', null, avail);

    if (events) {
      const bySev = { 1: 0, 2: 0, 3: 0 };
      const byCat = {};
      for (const e of events) {
        const s = e.alert?.severity;
        if (s >= 1 && s <= 3) bySev[s]++;
        const cat = (e.alert?.category || 'Unknown').slice(0, 64);
        byCat[cat] = (byCat[cat] || 0) + 1;
      }

      lines.push('# HELP soc_ids_suricata_alerts_parsed Alerts in current log window');
      lines.push('# TYPE soc_ids_suricata_alerts_parsed gauge');
      emit('soc_ids_suricata_alerts_parsed', null, events.length);

      lines.push('# HELP soc_ids_suricata_alerts_severity Alert count by severity level');
      lines.push('# TYPE soc_ids_suricata_alerts_severity gauge');
      const sevNames = { 1: 'critical', 2: 'high', 3: 'medium' };
      for (const [lvl, count] of Object.entries(bySev)) {
        emit('soc_ids_suricata_alerts_severity', { severity: sevNames[lvl] || `level_${lvl}` }, count);
      }

      lines.push('# HELP soc_ids_suricata_alerts_category Alert count by category (top 10)');
      lines.push('# TYPE soc_ids_suricata_alerts_category gauge');
      Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([cat, count]) => {
        emit('soc_ids_suricata_alerts_category', { category: cat }, count);
      });
    }
  } catch {}

  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n') + '\n');
});

module.exports = router;

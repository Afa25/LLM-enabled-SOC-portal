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

const MAX_LOG_BYTES = 50 * 1024 * 1024; // 50 MB guard

function readTailBytes(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  if (stat.size <= maxBytes) return fs.readFileSync(filePath, 'utf8');
  const fd  = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(maxBytes);
  fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
  fs.closeSync(fd);
  return buf.toString('utf8');
}

// ── GET /api/netdata/suricata ─────────────────────────────────
// Parse last 500 lines of eve.json, return most-recent 50 alert events
router.get('/suricata', auth, (req, res) => {
  try {
    if (!fs.existsSync(SURICATA_LOG)) {
      return res.json({ available: false, alerts: [] });
    }

    const raw    = readTailBytes(SURICATA_LOG, MAX_LOG_BYTES).trim().split('\n');
    const alerts = raw
      .slice(-500)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(e => e && e.event_type === 'alert')
      .slice(-50)
      .reverse()
      .map(e => ({
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
// Parse conn.log (TSV with #fields header), return last 50 connections
router.get('/zeek', auth, (req, res) => {
  try {
    // Zeek rotates logs into date dirs; also try a flat path
    const candidates = [
      path.join(ZEEK_LOG_DIR, 'current', 'conn.log'),
      path.join(ZEEK_LOG_DIR, 'conn.log'),
    ];
    const logFile = candidates.find(f => fs.existsSync(f));
    if (!logFile) return res.json({ available: false, connections: [] });

    const lines  = readTailBytes(logFile, MAX_LOG_BYTES).trim().split('\n');
    let   fields = [];
    const connections = [];

    for (const line of lines.slice(-1000)) {
      if (line.startsWith('#fields\t')) {
        fields = line.slice('#fields\t'.length).split('\t');
        continue;
      }
      if (line.startsWith('#')) continue;
      if (!fields.length) continue;

      const parts = line.split('\t');
      if (parts.length < fields.length) continue;

      const obj = {};
      fields.forEach((f, i) => { obj[f] = parts[i]; });

      connections.push({
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

    res.json({ available: true, connections: connections.slice(-50).reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

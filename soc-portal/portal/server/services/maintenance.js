const cron = require('node-cron');
const fs   = require('fs');
const path = require('path');
const db   = require('../db/database');

const ZEEK_DIR      = '/data/zeek';
const SURICATA_DIR  = '/data/suricata';
const PORTAL_DATA   = process.env.DATA_DIR || '/app/data';

// Delete files older than `days` under `dir`, returns count removed
function purgeOldFiles(dir, days) {
  if (!fs.existsSync(dir)) return 0;
  const cutoff = Date.now() - days * 86400 * 1000;
  let removed  = 0;
  try {
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          try {
            const stat = fs.statSync(full);
            if (stat.mtimeMs < cutoff) { fs.unlinkSync(full); removed++; }
          } catch { /* skip locked files */ }
        }
      }
    };
    walk(dir);
  } catch (e) {
    console.warn('[Maintenance] purge error:', e.message);
  }
  return removed;
}

// Returns disk usage % for the given path (0–100), or null if unavailable
function diskUsagePct(dir) {
  try {
    const stat = fs.statfsSync(dir);
    const used = stat.blocks - stat.bfree;
    return Math.round((used / stat.blocks) * 100);
  } catch { return null; }
}

function auditLog(action, detail) {
  try {
    db.get().prepare("INSERT INTO audit_log (user,action,detail) VALUES (?,?,?)").run('system', action, detail);
  } catch { /* non-fatal */ }
}

function runMaintenance() {
  console.log('[Maintenance] Daily cleanup starting...');

  const pct = diskUsagePct(PORTAL_DATA);
  if (pct !== null) {
    auditLog('MAINTENANCE_DISK_CHECK', `Disk usage: ${pct}%`);
    if (pct >= 90) {
      console.warn(`[Maintenance] Disk at ${pct}% — running aggressive cleanup (files > 7 days)`);
      const z = purgeOldFiles(ZEEK_DIR,     7);
      const s = purgeOldFiles(SURICATA_DIR, 7);
      auditLog('MAINTENANCE_PURGE', `Disk ${pct}% >= 90% — purged ${z} zeek + ${s} suricata files (>7d)`);
      console.log(`[Maintenance] Purged ${z} zeek + ${s} suricata files`);
    } else if (pct >= 80) {
      console.warn(`[Maintenance] Disk at ${pct}% — cleaning files > 14 days`);
      const z = purgeOldFiles(ZEEK_DIR,     14);
      const s = purgeOldFiles(SURICATA_DIR, 14);
      auditLog('MAINTENANCE_PURGE', `Disk ${pct}% >= 80% — purged ${z} zeek + ${s} suricata files (>14d)`);
      console.log(`[Maintenance] Purged ${z} zeek + ${s} suricata files`);
    } else {
      console.log(`[Maintenance] Disk at ${pct}% — no cleanup needed`);
    }
  }

  // Always prune triage results older than 90 days
  try {
    const ninety = new Date(Date.now() - 90 * 86400 * 1000).toISOString();
    const { changes } = db.get().prepare(
      "DELETE FROM triage_results WHERE created < ? AND analyst_status != 'pending'"
    ).run(ninety);
    if (changes > 0) {
      auditLog('MAINTENANCE_TRIAGE_PRUNE', `Removed ${changes} resolved triage records older than 90 days`);
      console.log(`[Maintenance] Pruned ${changes} old triage records`);
    }
  } catch (e) {
    console.warn('[Maintenance] triage prune error:', e.message);
  }

  // Prune audit_log older than 180 days
  try {
    const oneEighty = new Date(Date.now() - 180 * 86400 * 1000).toISOString();
    const { changes } = db.get().prepare("DELETE FROM audit_log WHERE ts < ?").run(oneEighty);
    if (changes > 0) {
      console.log(`[Maintenance] Pruned ${changes} old audit log entries`);
    }
  } catch { /* non-fatal */ }

  console.log('[Maintenance] Cleanup complete');
}

function startMaintenance() {
  // Run at 02:00 every night
  cron.schedule('0 2 * * *', runMaintenance);
  console.log('[Maintenance] Scheduled daily cleanup at 02:00');
}

module.exports = { startMaintenance, runMaintenance };

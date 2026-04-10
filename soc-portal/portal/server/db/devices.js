const db = require('./database');

const ALLOWED_TYPES = new Set(['endpoint', 'server', 'network', 'mobile', 'iot', 'other']);

function normalizeType(type) {
  const value = (type || 'other').toLowerCase();
  return ALLOWED_TYPES.has(value) ? value : 'other';
}

function safeParse(json) {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

function mapRow(row) {
  if (!row) return null;
  return {
    ...row,
    charging: !!row.charging,
    metadata: safeParse(row.metadata)
  };
}

function listDevices({ type } = {}) {
  const conn = db.get();
  const normalized = type ? normalizeType(type) : null;
  const shouldFilter = type && type !== 'all' && ALLOWED_TYPES.has(normalized);
  const rows = shouldFilter
    ? conn.prepare('SELECT * FROM devices WHERE type = ? ORDER BY updated DESC').all(normalized)
    : conn.prepare('SELECT * FROM devices ORDER BY updated DESC').all();
  return rows.map(mapRow);
}

function getDevice(id) {
  const row = db.get().prepare('SELECT * FROM devices WHERE id = ?').get(id);
  return mapRow(row);
}

function createDevice(input) {
  const conn = db.get();
  const now = new Date().toISOString();
  const stmt = conn.prepare(`
    INSERT INTO devices (name, type, platform, os_version, ip, mac, owner, status, battery, charging, health_score, last_seen, notes, metadata, created, updated)
    VALUES (@name, @type, @platform, @os_version, @ip, @mac, @owner, @status, @battery, @charging, @health_score, @last_seen, @notes, @metadata, @created, @updated)
  `);
  const payload = {
    name: input.name,
    type: normalizeType(input.type),
    platform: input.platform || null,
    os_version: input.os_version || null,
    ip: input.ip || null,
    mac: input.mac || null,
    owner: input.owner || null,
    status: input.status || 'unknown',
    battery: Number.isFinite(input.battery) ? input.battery : null,
    charging: input.charging ? 1 : 0,
    health_score: Number.isFinite(input.health_score) ? input.health_score : null,
    last_seen: input.last_seen || null,
    notes: input.notes || null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    created: now,
    updated: now
  };
  const info = stmt.run(payload);
  return getDevice(info.lastInsertRowid);
}

function updateDevice(id, input) {
  const conn = db.get();
  const existing = getDevice(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const payload = {
    id,
    name: input.name ?? existing.name,
    type: normalizeType(input.type ?? existing.type),
    platform: input.platform ?? existing.platform,
    os_version: input.os_version ?? existing.os_version,
    ip: input.ip ?? existing.ip,
    mac: input.mac ?? existing.mac,
    owner: input.owner ?? existing.owner,
    status: input.status ?? existing.status,
    battery: Number.isFinite(input.battery) ? input.battery : existing.battery,
    charging: typeof input.charging === 'boolean' ? (input.charging ? 1 : 0) : (existing.charging ? 1 : 0),
    health_score: Number.isFinite(input.health_score) ? input.health_score : existing.health_score,
    last_seen: input.last_seen ?? existing.last_seen,
    notes: input.notes ?? existing.notes,
    metadata: input.metadata ? JSON.stringify(input.metadata) : (existing.metadata ? JSON.stringify(existing.metadata) : null),
    updated: now
  };
  conn.prepare(`
    UPDATE devices
    SET name=@name, type=@type, platform=@platform, os_version=@os_version, ip=@ip, mac=@mac, owner=@owner,
        status=@status, battery=@battery, charging=@charging, health_score=@health_score, last_seen=@last_seen,
        notes=@notes, metadata=@metadata, updated=@updated
    WHERE id=@id
  `).run(payload);
  return getDevice(id);
}

function recordHeartbeat(id, input) {
  const conn = db.get();
  const existing = getDevice(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const payload = {
    id,
    status: input.status || 'online',
    battery: Number.isFinite(input.battery) ? input.battery : existing.battery,
    charging: typeof input.charging === 'boolean' ? (input.charging ? 1 : 0) : (existing.charging ? 1 : 0),
    health_score: Number.isFinite(input.health_score) ? input.health_score : existing.health_score,
    last_seen: now,
    ip: input.ip ?? existing.ip,
    notes: input.notes ?? existing.notes,
    metadata: input.metadata ? JSON.stringify(input.metadata) : (existing.metadata ? JSON.stringify(existing.metadata) : null),
    updated: now
  };
  conn.prepare(`
    UPDATE devices
    SET status=@status, battery=@battery, charging=@charging, health_score=@health_score,
        last_seen=@last_seen, ip=@ip, notes=@notes, metadata=@metadata, updated=@updated
    WHERE id=@id
  `).run(payload);
  return getDevice(id);
}

function deleteDevice(id) {
  const conn = db.get();
  const existing = getDevice(id);
  if (!existing) return null;
  conn.prepare('DELETE FROM devices WHERE id = ?').run(id);
  return existing;
}

module.exports = {
  listDevices,
  getDevice,
  createDevice,
  updateDevice,
  recordHeartbeat,
  deleteDevice,
  ALLOWED_TYPES
};

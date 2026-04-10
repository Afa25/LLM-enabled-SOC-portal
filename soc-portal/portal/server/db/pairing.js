const crypto = require('crypto');
const db = require('./database');
const devices = require('./devices');

const TTL_MIN = parseInt(process.env.PAIRING_TTL_MIN || '5', 10);
const CODE_LEN = parseInt(process.env.PAIRING_CODE_LENGTH || '6', 10);

function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function generateCode() {
  const max = 10 ** CODE_LEN;
  const value = crypto.randomInt(0, max);
  return String(value).padStart(CODE_LEN, '0');
}

function createPairing({ createdBy } = {}) {
  const conn = db.get();
  const now = new Date();
  const expires = new Date(now.getTime() + TTL_MIN * 60000).toISOString();

  for (let i = 0; i < 5; i += 1) {
    const token = generateToken();
    const code = generateCode();
    try {
      conn.prepare(`
        INSERT INTO pairing_tokens (token, code, status, created, expires, created_by)
        VALUES (?, ?, 'pending', ?, ?, ?)
      `).run(token, code, now.toISOString(), expires, createdBy || null);
      return { token, code, expires_at: expires };
    } catch (err) {
      if (!/UNIQUE/i.test(err.message)) throw err;
    }
  }

  throw new Error('Unable to create pairing token');
}

function consumePairing({ token, code, device = {}, requestIp } = {}) {
  const conn = db.get();
  const now = new Date().toISOString();

  const select = token
    ? conn.prepare('SELECT * FROM pairing_tokens WHERE token = ?')
    : conn.prepare('SELECT * FROM pairing_tokens WHERE code = ?');
  const row = select.get(token || code);
  if (!row) return { error: 'Invalid or expired code' };

  if (row.status !== 'pending') return { error: 'Code already used' };

  const expiresAt = new Date(row.expires).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    conn.prepare('UPDATE pairing_tokens SET status = ?, used = ? WHERE id = ?')
      .run('expired', now, row.id);
    return { error: 'Code expired' };
  }

  const devicePayload = {
    name: device.name || `Mobile Device ${row.code}`,
    type: 'mobile',
    platform: device.platform || null,
    os_version: device.os_version || null,
    owner: device.owner || null,
    ip: device.ip || requestIp || null,
    status: 'online',
    last_seen: now,
    metadata: {
      linked_via: 'pairing',
      pairing_id: row.id,
      pairing_code: row.code,
      app_version: device.app_version || null,
      device_id: device.device_id || null
    }
  };

  const tx = conn.transaction(() => {
    const created = devices.createDevice(devicePayload);
    conn.prepare(`
      UPDATE pairing_tokens
      SET status = 'used', used = ?, device_id = ?
      WHERE id = ?
    `).run(now, created.id, row.id);
    return created;
  });

  const createdDevice = tx();
  return { device: createdDevice };
}

module.exports = { createPairing, consumePairing };

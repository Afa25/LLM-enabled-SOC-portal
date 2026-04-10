const Database = require('better-sqlite3');
const path     = require('path');
const bcrypt   = require('bcryptjs');

const DB_PATH = path.join(process.env.DATA_DIR || '/app/data', 'soc.db');
let db;

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT    UNIQUE NOT NULL,
      password TEXT    NOT NULL,
      role     TEXT    NOT NULL DEFAULT 'analyst',
      created  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      timeframe   TEXT    NOT NULL,
      start_date  TEXT    NOT NULL,
      end_date    TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      model       TEXT    NOT NULL,
      alert_count INTEGER DEFAULT 0,
      created     TEXT    DEFAULT (datetime('now')),
      schedule_id INTEGER REFERENCES schedules(id)
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT    NOT NULL,
      timeframe TEXT    NOT NULL CHECK(timeframe IN ('daily','weekly','monthly','custom')),
      cron_expr TEXT    NOT NULL,
      model     TEXT    NOT NULL DEFAULT 'llama3.2:3b',
      enabled   INTEGER NOT NULL DEFAULT 1,
      last_run  TEXT,
      next_run  TEXT,
      created   TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      user    TEXT    NOT NULL,
      action  TEXT    NOT NULL,
      detail  TEXT,
      ts      TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS devices (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL,
      type         TEXT    NOT NULL CHECK(type IN ('endpoint','server','network','mobile','iot','other')),
      platform     TEXT,
      os_version   TEXT,
      ip           TEXT,
      mac          TEXT,
      owner        TEXT,
      status       TEXT    NOT NULL DEFAULT 'unknown',
      battery      INTEGER,
      charging     INTEGER NOT NULL DEFAULT 0,
      health_score INTEGER,
      last_seen    TEXT,
      notes        TEXT,
      metadata     TEXT,
      created      TEXT    DEFAULT (datetime('now')),
      updated      TEXT    DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_devices_type ON devices(type);
    CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
    CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);

    CREATE TABLE IF NOT EXISTS pairing_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      token      TEXT    UNIQUE NOT NULL,
      code       TEXT    UNIQUE NOT NULL,
      status     TEXT    NOT NULL CHECK(status IN ('pending','used','expired','revoked')) DEFAULT 'pending',
      created    TEXT    DEFAULT (datetime('now')),
      expires    TEXT    NOT NULL,
      used       TEXT,
      device_id  INTEGER,
      created_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pairing_token ON pairing_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_pairing_code ON pairing_tokens(code);
    CREATE INDEX IF NOT EXISTS idx_pairing_status ON pairing_tokens(status);
  `);

  // Seed default admin user if not exists
  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get(
    process.env.PORTAL_USER || 'admin'
  );
  if (!admin) {
    const hash = bcrypt.hashSync(process.env.PORTAL_PASS || 'SocPortal1!', 10);
    db.prepare('INSERT INTO users (username, password, role) VALUES (?,?,?)').run(
      process.env.PORTAL_USER || 'admin', hash, 'admin'
    );
    console.log('Default admin user created.');
  }

  console.log('Database initialised at', DB_PATH);
}

function get() { return db; }

module.exports = { init, get };

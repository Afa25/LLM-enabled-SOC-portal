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

    CREATE TABLE IF NOT EXISTS triage_results (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id           TEXT    UNIQUE NOT NULL,
      alert_data         TEXT    NOT NULL,
      verdict            TEXT    NOT NULL CHECK(verdict IN ('true_positive','false_positive','needs_review')),
      confidence         INTEGER NOT NULL CHECK(confidence BETWEEN 0 AND 100),
      explanation        TEXT    NOT NULL,
      mitre_tactic       TEXT,
      recommended_action TEXT    NOT NULL,
      model              TEXT    NOT NULL,
      analyst_status     TEXT    NOT NULL DEFAULT 'pending'
                                   CHECK(analyst_status IN ('pending','confirmed','dismissed')),
      analyst_note       TEXT,
      created            TEXT    DEFAULT (datetime('now')),
      reviewed           TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_triage_alert_id ON triage_results(alert_id);
    CREATE INDEX IF NOT EXISTS idx_triage_verdict ON triage_results(verdict);
    CREATE INDEX IF NOT EXISTS idx_triage_analyst ON triage_results(analyst_status);
  `);

  // Seed or sync admin user from env on every startup
  const adminUser = process.env.PORTAL_USER || 'admin';
  const adminPass = process.env.PORTAL_PASS || 'SocPortal1!';
  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUser);
  if (!admin) {
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare('INSERT INTO users (username, password, role) VALUES (?,?,?)').run(adminUser, hash, 'admin');
    console.log('Admin user created:', adminUser);
  } else if (process.env.PORTAL_PASS) {
    // Re-hash and update whenever PORTAL_PASS is explicitly set in env
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare('UPDATE users SET password = ? WHERE username = ?').run(hash, adminUser);
    console.log('Admin password synced from env for:', adminUser);
  }

  console.log('Database initialised at', DB_PATH);
}

function get() { return db; }

module.exports = { init, get };

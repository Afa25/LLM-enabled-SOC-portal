const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db/database');
const captcha = require('../services/captcha');

const router  = express.Router();

if (!process.env.JWT_SECRET) {
  console.error('[SECURITY] JWT_SECRET env var is not set — using insecure default. Set it in .env before production use.');
}
const SECRET  = process.env.JWT_SECRET || 'dev-secret';

// ── Brute-force protection ─────────────────────────────────────
// Tracks failed login attempts per IP. Locks out after 5 failures for 15 min.
const loginAttempts = new Map();
const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS    = 15 * 60 * 1000;

function checkBruteForce(ip) {
  const now    = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  if (record.lockedUntil > now) {
    const remaining = Math.ceil((record.lockedUntil - now) / 60000);
    return { locked: true, remaining };
  }
  return { locked: false, count: record.count };
}

function recordFailedLogin(ip) {
  const now    = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
    record.count       = 0;
  }
  loginAttempts.set(ip, record);
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

// Prune expired lockouts every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of loginAttempts) {
    if (rec.lockedUntil > 0 && rec.lockedUntil < now) loginAttempts.delete(ip);
  }
}, 30 * 60 * 1000);

const SESSION_COOKIE = 'soc_session';
const isProduction   = process.env.NODE_ENV === 'production';
const COOKIE_OPTS    = `HttpOnly; Path=/; Max-Age=28800; SameSite=Lax${isProduction ? '; Secure' : ''}`;

function parseCookies(req) {
  const cookies = {};
  const header  = req.headers.cookie;
  if (!header) return cookies;
  header.split(';').forEach(part => {
    const [key, ...rest] = part.trim().split('=');
    cookies[key.trim()] = decodeURIComponent(rest.join('=').trim());
  });
  return cookies;
}

// ── Middleware ─────────────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised' });
  try {
    req.user = jwt.verify(header.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalid or expired' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ── Login ─────────────────────────────────────────────────────
// CAPTCHA endpoint — issues a short-lived math challenge
router.get('/captcha', (req, res) => {
  try {
    const c = captcha.generateCaptcha();
    res.json(c);
  } catch (err) {
    res.status(500).json({ error: 'Unable to generate captcha' });
  }
});

router.post('/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const bf = checkBruteForce(ip);
  if (bf.locked) {
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${bf.remaining} minute(s).` });
  }

  const { username, password, captchaId, captchaAnswer } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  if (!captchaId || typeof captchaAnswer === 'undefined') return res.status(400).json({ error: 'Missing CAPTCHA' });

  if (!captcha.verifyCaptcha(captchaId, captchaAnswer)) {
    recordFailedLogin(ip);
    return res.status(400).json({ error: 'CAPTCHA failed' });
  }

  const user = db.get().prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    recordFailedLogin(ip);
    db.get().prepare("INSERT INTO audit_log (user,action,detail) VALUES (?,?,?)").run(
      username, 'LOGIN_FAILED', `IP: ${ip}`
    );
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  clearLoginAttempts(ip);

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: '8h' }
  );

  db.get().prepare("INSERT INTO audit_log (user,action,detail) VALUES (?,?,?)").run(
    username, 'LOGIN', `IP: ${ip}`
  );

  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; ${COOKIE_OPTS}`);
  res.json({ token, user: { username: user.username, role: user.role } });
});

// ── Me ────────────────────────────────────────────────────────
router.get('/me', auth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// ── Validate (used by nginx auth_request) ─────────────────────
// Reads soc_session cookie OR Authorization header
router.get('/validate', (req, res) => {
  const cookies    = parseCookies(req);
  const cookieTok  = cookies[SESSION_COOKIE];
  const bearerTok  = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = cookieTok || bearerTok;

  if (!token) return res.status(401).json({ error: 'No session' });

  try {
    const user = jwt.verify(token, SECRET);
    res.setHeader('X-Auth-User', user.username);
    res.setHeader('X-Auth-Role',  user.role);
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
});

// ── Logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  res.json({ ok: true });
});

module.exports = router;
module.exports.auth = auth;
module.exports.adminOnly = adminOnly;

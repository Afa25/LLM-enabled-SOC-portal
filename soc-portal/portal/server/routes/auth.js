const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db/database');
const captcha = require('../services/captcha');

const router  = express.Router();
const SECRET  = process.env.JWT_SECRET || 'dev-secret';

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
  const { username, password, captchaId, captchaAnswer } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  if (!captchaId || typeof captchaAnswer === 'undefined') return res.status(400).json({ error: 'Missing CAPTCHA' });

  if (!captcha.verifyCaptcha(captchaId, captchaAnswer)) return res.status(400).json({ error: 'CAPTCHA failed' });

  const user = db.get().prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    SECRET,
    { expiresIn: '8h' }
  );

  db.get().prepare("INSERT INTO audit_log (user,action,detail) VALUES (?,?,?)").run(
    username, 'LOGIN', `IP: ${req.ip}`
  );

  res.json({ token, user: { username: user.username, role: user.role } });
});

// ── Me ────────────────────────────────────────────────────────
router.get('/me', auth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

module.exports = router;
module.exports.auth = auth;
module.exports.adminOnly = adminOnly;

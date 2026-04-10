const crypto = require('crypto');

const store = new Map(); // id -> { answer, expires }
const TTL_MS = 5 * 60 * 1000; // 5 minutes

function _cleanup() {
  const now = Date.now();
  for (const [k, v] of store.entries()) if (v.expires <= now) store.delete(k);
}
setInterval(_cleanup, 60_000).unref();

function generateCaptcha() {
  const a = 1 + Math.floor(Math.random() * 20);
  const b = 1 + Math.floor(Math.random() * 20);
  const op = Math.random() < 0.5 ? '+' : '-';
  const question = `What is ${a} ${op} ${b}?`;
  const answer = op === '+' ? a + b : a - b;
  const id = crypto.randomBytes(12).toString('hex');
  store.set(id, { answer: String(answer), expires: Date.now() + TTL_MS });
  return { id, question };
}

function verifyCaptcha(id, provided) {
  if (!id || !provided) return false;
  const entry = store.get(id);
  if (!entry) return false;
  // consume it to avoid reuse
  store.delete(id);
  if (entry.expires <= Date.now()) return false;
  return String(provided).trim() === String(entry.answer);
}

module.exports = { generateCaptcha, verifyCaptcha };

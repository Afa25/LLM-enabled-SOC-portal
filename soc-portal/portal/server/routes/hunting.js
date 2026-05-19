const express    = require('express');
const { exec }   = require('child_process');
const { promisify } = require('util');
const path       = require('path');
const fs         = require('fs');
const { auth }   = require('./auth');

const router    = express.Router();
const execAsync = promisify(exec);

const YARA_RULES_PATH  = process.env.YARA_RULES_PATH  || '/opt/yara-rules';
const SIGMA_RULES_PATH = process.env.SIGMA_RULES_PATH || '/opt/sigma-rules/rules';

function safeCountFiles(dir, ext) {
  try {
    const out = require('child_process').execSync(
      `find ${dir} -name "*.${ext}" -type f 2>/dev/null | wc -l`,
      { timeout: 10000 }
    );
    return parseInt(out.toString().trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function listCategories(dir, ext) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(item => {
        const p = path.join(dir, item);
        return fs.statSync(p).isDirectory() && !item.startsWith('.');
      })
      .map(item => {
        const p = path.join(dir, item);
        const count = safeCountFiles(p, ext);
        return { name: item, count };
      });
  } catch {
    return [];
  }
}

// ── GET /api/hunting/yara ─────────────────────────────────────
router.get('/yara', auth, (req, res) => {
  const installed = fs.existsSync('/usr/bin/yara') || fs.existsSync('/usr/local/bin/yara');
  const total     = safeCountFiles(YARA_RULES_PATH, 'yar');
  const categories = listCategories(YARA_RULES_PATH, 'yar');
  res.json({ installed, total_rules: total, rules_path: YARA_RULES_PATH, categories });
});

// ── GET /api/hunting/sigma ────────────────────────────────────
router.get('/sigma', auth, (req, res) => {
  const total      = safeCountFiles(SIGMA_RULES_PATH, 'yml');
  const categories = listCategories(SIGMA_RULES_PATH, 'yml');
  res.json({ total_rules: total, rules_path: SIGMA_RULES_PATH, categories });
});

// ── POST /api/hunting/update ──────────────────────────────────
// Body: { type: "yara" | "sigma" | "all" }
router.post('/update', auth, async (req, res) => {
  const { type = 'all' } = req.body || {};
  const results = {};

  const validPaths = {
    yara:  YARA_RULES_PATH,
    sigma: path.dirname(SIGMA_RULES_PATH),
  };

  const targets = type === 'all' ? ['yara', 'sigma'] : [type];

  for (const t of targets) {
    const dir = validPaths[t];
    if (!dir) { results[t] = { success: false, output: 'Unknown type' }; continue; }
    try {
      if (!fs.existsSync(path.join(dir, '.git'))) {
        results[t] = { success: false, output: 'Rules not cloned yet — run init-rules container first.' };
        continue;
      }
      const { stdout, stderr } = await execAsync(`git -C ${dir} pull`, { timeout: 30000 });
      results[t] = { success: true, output: (stdout + stderr).trim() };
    } catch (err) {
      results[t] = { success: false, output: err.message };
    }
  }

  res.json({ success: true, results });
});

module.exports = router;

/**
 * agentTools.js — Primitive tool executor for the SOC agent loop.
 *
 * Four primitive tools:
 *   run_shell    – execute a shell command (docker, grep, netstat, etc.)
 *   http_request – call an internal HTTP API
 *   read_file    – read a file from the server filesystem
 *   write_file   – write content to a file (always Tier 2)
 *
 * Tier system:
 *   1 – Read-only, auto-approved, executes immediately
 *   2 – Mutating/write, requires explicit user approval before execution
 *   3 – Destructive or externally-reachable, blocked entirely
 */

const { execSync } = require('child_process');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const fs   = require('fs');
const path = require('path');

// ── Tier 3 blocklist — shell commands that must NEVER execute ──────────────
const TIER3_SHELL = [
  /rm\s+-rf/i,
  /\|\s*(bash|sh)\b/i,
  /\bwget\b.*\|\s*/i,
  /\bcurl\b.*\|\s*(bash|sh)\b/i,
  /iptables\s+-F/i,
  />\s*\/etc\/shadow/i,
  />\s*\/etc\/passwd/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\b(shutdown|reboot|poweroff|halt)\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
];

// ── Tier 2 — shell commands that mutate state, require approval ────────────
const TIER2_SHELL = [
  /\bdocker\s+(restart|stop|start|rm|kill|exec|run)\b/i,
  /\bdocker-compose\s+(down|up|restart|pull)\b/i,
  /\bsystemctl\s+(restart|stop|start|disable|enable)\b/i,
  /\bservice\s+\S+\s+(restart|stop|start)\b/i,
  /\bapt(-get)?\s+(install|remove|purge|upgrade)\b/i,
  /\bnpm\s+install\b/i,
  /\bpip\s+install\b/i,
  /\bsystemctl\s+daemon-reload\b/i,
  /\bkill\s+-9\b/i,
  /\bkillall\b/i,
];

// ── Paths blocked for read_file ─────────────────────────────────────────────
const BLOCKED_READ_PATHS = [
  /\/etc\/shadow$/i,
  /\/etc\/passwd$/i,
  /\/etc\/sudoers/i,
  /\.env$/i,
  /\/id_rsa$/i,
  /\.pem$/i,
  /\.key$/i,
  /\/\.ssh\//i,
];

// ── Paths blocked for write_file ────────────────────────────────────────────
const BLOCKED_WRITE_PATHS = [
  /^\/etc\//i,
  /^\/bin\//i,
  /^\/sbin\//i,
  /^\/usr\/bin\//i,
  /^\/usr\/sbin\//i,
  /^\/boot\//i,
  /\/etc\/shadow/i,
  /\.env$/i,
];

// External URL: anything not on localhost, 127.*, 172.*, 10.*, 192.168.*
const EXTERNAL_URL_RE = /^https?:\/\/(?!(?:localhost|127\.\d|172\.\d{1,3}\.|10\.\d|192\.168\.))/i;

// ── Tier classifiers ────────────────────────────────────────────────────────
function classifyShell(command) {
  const cmd = String(command);
  for (const p of TIER3_SHELL) if (p.test(cmd)) return 3;
  for (const p of TIER2_SHELL) if (p.test(cmd)) return 2;
  return 1;
}

function classifyHttp(method, url) {
  if (EXTERNAL_URL_RE.test(url)) return 3;
  const m = String(method).toUpperCase();
  return (m === 'GET' || m === 'HEAD') ? 1 : 2;
}

function classifyRead(filePath) {
  const p = String(filePath);
  for (const re of BLOCKED_READ_PATHS) if (re.test(p)) return 3;
  return 1;
}

function classifyWrite(filePath) {
  const p = String(filePath);
  for (const re of BLOCKED_WRITE_PATHS) if (re.test(p)) return 3;
  return 2; // all writes require approval
}

/**
 * Returns the tier (1/2/3) for a given tool + args pair.
 */
function getTier(tool, args = {}) {
  switch (tool) {
    case 'run_shell':    return classifyShell(args.command   || '');
    case 'http_request': return classifyHttp(args.method || 'GET', args.url || '');
    case 'read_file':    return classifyRead(args.path       || '');
    case 'write_file':   return classifyWrite(args.path      || '');
    default:             return 3; // unknown tool → blocked
  }
}

// ── Tool name normalizer — fixes small-model mis-naming ──────────────────────
// Small LLMs (3B) put the command name in "tool" instead of "run_shell".
// Remap wrong names to canonical tool names before tier classification.

const CANONICAL_TOOLS = new Set(['run_shell', 'http_request', 'read_file', 'write_file']);

const TOOL_ALIASES = {
  // run_shell aliases
  shell: 'run_shell', bash: 'run_shell', cmd: 'run_shell', command: 'run_shell',
  exec: 'run_shell', terminal: 'run_shell', execute: 'run_shell',
  run_command: 'run_shell', run: 'run_shell', docker: 'run_shell',
  // http_request aliases
  http: 'http_request', request: 'http_request',
  api: 'http_request', fetch: 'http_request', http_get: 'http_request', api_call: 'http_request',
  // read_file aliases
  cat: 'read_file', file: 'read_file', read: 'read_file',
  open: 'read_file', open_file: 'read_file', file_read: 'read_file',
  // write_file aliases
  write: 'write_file', save: 'write_file', create_file: 'write_file',
  file_write: 'write_file', append_file: 'write_file',
};

// Tool name starts with a recognisable shell binary
const LOOKS_LIKE_CMD = /^(docker\s?|kubectl\s?|ls\s?|ps\s?|grep\s?|find\s?|netstat\s?|ss\s|ip\s|ping\s?|nmap\s?|systemctl\s?|journalctl\s?|df\s?|du\s?|awk\s?|sed\s?|sort\s?|head\s?|tail\s?|wc\s?|curl\s|wget\s)/i;

function normalizeToolCall(raw) {
  if (!raw || typeof raw.tool !== 'string') return raw;
  if (CANONICAL_TOOLS.has(raw.tool)) return raw;

  const { args = {} } = raw;
  const key = raw.tool.toLowerCase().trim();

  const alias = TOOL_ALIASES[key];
  if (alias) return { tool: alias, args };

  // Tool name IS the shell command (with or without spaces)
  if (LOOKS_LIKE_CMD.test(raw.tool) || raw.tool.includes(' ')) {
    const existing = typeof args.command === 'string' && args.command ? ` ${args.command}` : '';
    return { tool: 'run_shell', args: { ...args, command: raw.tool + existing } };
  }

  // Unknown fallback → treat as shell command
  const command = (typeof args.command === 'string' && args.command) ? args.command : raw.tool;
  return { tool: 'run_shell', args: { ...args, command } };
}

// ── Tool execution functions ────────────────────────────────────────────────

const MAX_OUTPUT = 5000; // characters

async function runShell(command) {
  try {
    const raw = execSync(String(command), {
      timeout : 30_000,
      encoding: 'utf8',
      env     : { ...process.env, TERM: 'dumb' },
    });
    const out = raw.trim();
    return {
      ok    : true,
      output: out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + '\n…(truncated)' : out,
    };
  } catch (err) {
    const msg = (err.stderr || err.message || '').trim().slice(0, 1000);
    return { ok: false, error: msg };
  }
}

async function httpRequest(method, url, body = null) {
  const opts = {
    method : String(method).toUpperCase(),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    signal : AbortSignal.timeout(15_000),
  };
  if (body && !['GET', 'HEAD'].includes(opts.method)) {
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res  = await fetch(url, opts);
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { parsed = text.length > MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) + '…' : text; }
  return { ok: res.ok, status: res.status, data: parsed };
}

async function readFile(filePath) {
  try {
    const raw = fs.readFileSync(String(filePath), 'utf8');
    const out = raw.length > MAX_OUTPUT ? raw.slice(0, MAX_OUTPUT) + '\n…(truncated)' : raw;
    return { ok: true, content: out };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function writeFile(filePath, content) {
  try {
    const dir = path.dirname(String(filePath));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(String(filePath), String(content), 'utf8');
    return { ok: true, message: `Written: ${filePath}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Execute a tool by name with the given args object.
 * Assumes tier has already been validated by the caller.
 */
async function executeTool(tool, args = {}) {
  switch (tool) {
    case 'run_shell':    return runShell(args.command);
    case 'http_request': return httpRequest(args.method, args.url, args.body);
    case 'read_file':    return readFile(args.path);
    case 'write_file':   return writeFile(args.path, args.content);
    default:             return { ok: false, error: `Unknown tool: ${tool}` };
  }
}

// ── Tool manifest for the LLM system prompt ─────────────────────────────────
const TOOL_MANIFEST = `
════ TOOLS — use for live system data, never guess ════

To call a tool output EXACTLY one of these lines (nothing else on that line):

  <tool_call>{"tool":"run_shell","args":{"command":"BASH_COMMAND"}}</tool_call>
  <tool_call>{"tool":"http_request","args":{"method":"GET","url":"INTERNAL_URL"}}</tool_call>
  <tool_call>{"tool":"read_file","args":{"path":"/absolute/path"}}</tool_call>
  <tool_call>{"tool":"write_file","args":{"path":"/path","content":"TEXT"}}</tool_call>

WORKING EXAMPLES:
  <tool_call>{"tool":"run_shell","args":{"command":"docker ps"}}</tool_call>
  <tool_call>{"tool":"run_shell","args":{"command":"docker inspect wazuh-manager"}}</tool_call>
  <tool_call>{"tool":"run_shell","args":{"command":"docker logs wazuh-manager --tail 20"}}</tool_call>
  <tool_call>{"tool":"http_request","args":{"method":"GET","url":"http://prometheus:9090/api/v1/query?query=up"}}</tool_call>
  <tool_call>{"tool":"read_file","args":{"path":"/var/log/suricata/eve.json"}}</tool_call>

RULES:
  • "tool" must be exactly: run_shell  OR  http_request  OR  read_file  OR  write_file
  • NEVER put the command ("docker", "bash", etc.) as the "tool" value — it must be run_shell
  • write_file requires user approval
  • After [TOOL_RESULT] answer the user directly; do not call another tool unless needed
════════════════════════════════════════════════════
`.trim();

module.exports = { executeTool, getTier, normalizeToolCall, TOOL_MANIFEST };

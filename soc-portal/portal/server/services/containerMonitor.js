const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const POLL_INTERVAL_MS = 30_000;
const POLL_ERROR_INTERVAL_MS = 60_000;

class ContainerMonitor {
  constructor() {
    this.containers = {};
    this._timer = null;
    this._running = false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._poll();
  }

  stop() {
    this._running = false;
    if (this._timer) clearTimeout(this._timer);
  }

  getStatus() {
    return this.containers;
  }

  async _poll() {
    if (!this._running) return;
    let delay = POLL_INTERVAL_MS;
    try {
      this.containers = await this._fetchAll();
    } catch (err) {
      console.error('[ContainerMonitor] poll error:', err.message);
      delay = POLL_ERROR_INTERVAL_MS;
    }
    this._timer = setTimeout(() => this._poll(), delay);
  }

  async _fetchAll() {
    const { stdout } = await execFileAsync('docker', [
      'ps', '-a',
      '--format', '{{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}',
    ], { timeout: 10_000 });

    const containers = {};
    for (const line of stdout.trim().split('\n')) {
      if (!line.trim()) continue;
      const [name, statusText, image, ports] = line.split('\t');
      let state;
      if (statusText.startsWith('Up'))      state = 'running';
      else if (statusText.startsWith('Exited')) state = 'stopped';
      else if (statusText.startsWith('Restarting')) state = 'restarting';
      else state = 'unknown';

      containers[name] = { name, state, statusText, image, ports, updatedAt: new Date().toISOString() };
    }
    return containers;
  }
}

const monitor = new ContainerMonitor();
module.exports = monitor;

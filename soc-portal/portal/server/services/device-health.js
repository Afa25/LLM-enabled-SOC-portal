const snmp = require('./snmp');
const wazuh = require('./wazuh');
const devices = require('../db/devices');

const ONLINE_WINDOW_MIN = parseInt(process.env.DEVICE_ONLINE_WINDOW_MIN || '10', 10);

function safeArrayIp(ip) {
  if (Array.isArray(ip)) return ip[0];
  return ip || null;
}

function isMobileOs(osName, platform) {
  const value = `${osName || ''} ${platform || ''}`.toLowerCase();
  return /android|ios|iphone|ipad/.test(value);
}

function statusFromLastSeen(lastSeen, fallback) {
  if (fallback && fallback !== 'unknown') return fallback;
  if (!lastSeen) return 'unknown';
  const seen = new Date(lastSeen).getTime();
  if (Number.isNaN(seen)) return fallback || 'unknown';
  const diffMin = (Date.now() - seen) / 60000;
  return diffMin <= ONLINE_WINDOW_MIN ? 'online' : 'offline';
}

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    console.error('[DeviceHealth]', err.message);
    return fallback;
  }
}

async function getDeviceHealth() {
  const [agents, snmpHealth, inventory] = await Promise.all([
    safe(() => wazuh.getAgents(), []),
    safe(() => snmp.getEndpointHealth(), []),
    safe(() => Promise.resolve(devices.listDevices()), [])
  ]);

  const wazuhDevices = agents.map(a => {
    const osName = a?.os?.name || a?.os?.platform;
    const osVersion = a?.os?.version;
    const mobile = isMobileOs(osName, a?.os?.platform);
    return {
      id: `wazuh:${a.id}`,
      name: a.name || `agent-${a.id}`,
      type: mobile ? 'mobile' : 'endpoint',
      source: 'wazuh',
      status: a.status === 'active' ? 'online' : 'offline',
      ip: safeArrayIp(a.ip),
      platform: osName || null,
      os_version: osVersion || null,
      last_seen: a.lastKeepAlive || null
    };
  });

  const snmpDevices = snmpHealth.map(h => ({
    id: `snmp:${h.instance}`,
    name: h.instance || 'snmp-endpoint',
    type: 'network',
    source: 'snmp',
    status: h.status === 'up' ? 'online' : 'offline',
    ip: h.instance || null,
    last_seen: null,
    metrics: { scrape_seconds: h.scrape_seconds }
  }));

  const inventoryDevices = inventory.map(d => ({
    id: `db:${d.id}`,
    device_id: d.id,
    name: d.name,
    type: d.type,
    source: 'inventory',
    status: statusFromLastSeen(d.last_seen, d.status),
    ip: d.ip || null,
    owner: d.owner || null,
    platform: d.platform || null,
    os_version: d.os_version || null,
    battery: Number.isFinite(d.battery) ? d.battery : null,
    charging: !!d.charging,
    health_score: Number.isFinite(d.health_score) ? d.health_score : null,
    last_seen: d.last_seen || null,
    notes: d.notes || null,
    metadata: d.metadata || null
  }));

  return [...inventoryDevices, ...wazuhDevices, ...snmpDevices];
}

module.exports = { getDeviceHealth };

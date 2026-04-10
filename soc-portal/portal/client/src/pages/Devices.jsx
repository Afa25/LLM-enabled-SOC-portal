import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../App';
import QRCode from 'qrcode';
import {
  Smartphone, Monitor, Wifi, Search, RefreshCw,
  BatteryCharging, BatteryMedium, CheckCircle, XCircle, Trash2
} from 'lucide-react';

const TYPE_LABELS = {
  endpoint: 'Endpoint',
  server: 'Server',
  network: 'Network',
  mobile: 'Mobile',
  iot: 'IoT',
  other: 'Other'
};

const TYPE_ICONS = {
  endpoint: Monitor,
  server: Monitor,
  network: Wifi,
  mobile: Smartphone,
  iot: Smartphone,
  other: Monitor
};

const STATUS_STYLES = {
  online: 'bg-green-500/10 text-green-400 border-green-500/20',
  offline: 'bg-red-500/10 text-red-400 border-red-500/20',
  unknown: 'bg-gray-800 text-gray-400 border-gray-700'
};

function DeviceCard({ device, onDelete }) {
  const Icon = TYPE_ICONS[device.type] || Monitor;
  const status = device.status || 'unknown';
  const lastSeen = device.last_seen ? new Date(device.last_seen).toLocaleString() : 'Unknown';
  const battery = Number.isFinite(device.battery) ? Math.max(0, Math.min(100, device.battery)) : null;
  const platform = [device.platform, device.os_version].filter(Boolean).join(' ');
  const canDelete = device.source === 'inventory' && device.device_id;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={18} className="text-blue-400" />
          <p className="text-white font-semibold truncate">{device.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[status] || STATUS_STYLES.unknown}`}>
            {status}
          </span>
          {canDelete && (
            <button
              onClick={() => onDelete?.(device)}
              className="p-1.5 rounded-lg border border-red-500/20 text-red-300 hover:text-red-200 hover:border-red-400/40 transition-colors"
              title="Delete device"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
        <div>Type: <span className="text-gray-300">{TYPE_LABELS[device.type] || 'Other'}</span></div>
        <div>Source: <span className="text-gray-300">{device.source || 'unknown'}</span></div>
        <div className="col-span-2">IP: <span className="text-gray-300">{device.ip || 'n/a'}</span></div>
        <div className="col-span-2">Platform: <span className="text-gray-300">{platform || 'n/a'}</span></div>
        <div className="col-span-2">Last seen: <span className="text-gray-300">{lastSeen}</span></div>
      </div>

      {battery !== null && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          {device.charging ? <BatteryCharging size={14} /> : <BatteryMedium size={14} />}
          <span className="text-gray-300">Battery: {battery}%</span>
        </div>
      )}
    </div>
  );
}

export default function Devices() {
  const { apiFetch } = useAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [form, setForm] = useState({ name: '', type: 'mobile', platform: '', os_version: '', owner: '', ip: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deviceError, setDeviceError] = useState('');
  const [pairing, setPairing] = useState(null);
  const [pairingQr, setPairingQr] = useState('');
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingError, setPairingError] = useState('');
  const [pairingSeconds, setPairingSeconds] = useState(null);

  async function load() {
    setLoading(true);
    const res = await apiFetch('/api/health/devices');
    const data = await res?.json();
    setDevices(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!pairing?.expires_at) return undefined;
    const tick = () => {
      const ms = new Date(pairing.expires_at).getTime() - Date.now();
      setPairingSeconds(ms > 0 ? Math.ceil(ms / 1000) : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pairing?.expires_at]);

  const filtered = useMemo(() => {
    return devices.filter(d => {
      const matchesType = typeFilter === 'all' || d.type === typeFilter;
      const query = search.toLowerCase();
      const matchesSearch = !query ||
        (d.name || '').toLowerCase().includes(query) ||
        (d.ip || '').includes(query) ||
        (d.owner || '').toLowerCase().includes(query) ||
        (d.platform || '').toLowerCase().includes(query);
      return matchesType && matchesSearch;
    });
  }, [devices, typeFilter, search]);

  const summary = useMemo(() => {
    const online = devices.filter(d => d.status === 'online').length;
    const offline = devices.filter(d => d.status === 'offline').length;
    const mobile = devices.filter(d => d.type === 'mobile').length;
    return { total: devices.length, online, offline, mobile };
  }, [devices]);

  async function handleAdd(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const res = await apiFetch('/api/devices', {
      method: 'POST',
      body: JSON.stringify(form)
    });
    if (!res?.ok) {
      const data = await res?.json();
      setError(data?.error || 'Failed to add device');
      setSaving(false);
      return;
    }
    setForm({ name: '', type: 'mobile', platform: '', os_version: '', owner: '', ip: '' });
    setSaving(false);
    load();
  }

  async function handleDelete(device) {
    if (!device?.device_id) return;
    const confirmed = window.confirm(`Delete "${device.name}"? This cannot be undone.`);
    if (!confirmed) return;
    setDeviceError('');
    const res = await apiFetch(`/api/devices/${device.device_id}`, { method: 'DELETE' });
    if (!res?.ok) {
      const data = await res?.json();
      setDeviceError(data?.error || 'Failed to delete device');
      return;
    }
    load();
  }

  async function handlePairing() {
    setPairingLoading(true);
    setPairingError('');
    setPairingQr('');
    try {
      const res = await apiFetch('/api/pairing/start', { method: 'POST' });
      const data = await res?.json();
      if (!res?.ok) {
        setPairingError(data?.error || 'Failed to create pairing code');
        setPairingLoading(false);
        return;
      }
      setPairing(data);
      const payload = data.qr_payload || data.token || data.code;
      const qr = await QRCode.toDataURL(payload, {
        margin: 1,
        width: 220,
        color: { dark: '#0f172a', light: '#ffffff' }
      });
      setPairingQr(qr);
    } catch (err) {
      setPairingError(err?.message || 'Failed to generate QR code');
    } finally {
      setPairingLoading(false);
    }
  }

  const pairingCountdown = useMemo(() => {
    if (pairingSeconds === null) return '';
    if (pairingSeconds <= 0) return 'Expired';
    const mins = Math.floor(pairingSeconds / 60);
    const secs = String(pairingSeconds % 60).padStart(2, '0');
    return `${mins}:${secs} remaining`;
  }, [pairingSeconds]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Devices</h1>
          <p className="text-gray-500 text-sm mt-0.5">Unified device health across endpoints, network gear, and mobile devices</p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Devices', val: summary.total, color: 'border-gray-700 text-white' },
          { label: 'Online', val: summary.online, color: 'border-green-500/30 text-green-400' },
          { label: 'Offline', val: summary.offline, color: 'border-red-500/30 text-red-400' },
          { label: 'Mobile', val: summary.mobile, color: 'border-blue-500/30 text-blue-400' }
        ].map(({ label, val, color }) => (
          <div key={label} className={`bg-gray-900 rounded-xl border p-4 text-center ${color}`}>
            <p className="text-2xl font-bold">{loading ? '-' : val}</p>
            <p className="text-gray-500 text-sm mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex flex-wrap gap-2">
            {['all','mobile','endpoint','network','server','iot','other'].map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  typeFilter === t ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {t === 'all' ? 'All' : (TYPE_LABELS[t] || 'Other')}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, IP, owner, or platform"
              className="w-full bg-gray-900 border border-gray-800 text-gray-300 text-sm rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {deviceError && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <XCircle size={14} /> {deviceError}
            </div>
          )}

          {loading ? (
            <div className="grid sm:grid-cols-2 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
                  <div className="h-5 bg-gray-800 rounded animate-pulse w-1/2" />
                  <div className="h-3 bg-gray-800 rounded animate-pulse w-full" />
                  <div className="h-3 bg-gray-800 rounded animate-pulse w-3/4" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600">
              <Monitor size={40} className="mb-3 opacity-30" />
              <p className="font-medium text-gray-500">No devices match your filters</p>
              <p className="text-sm mt-1">Try a different search or type filter</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {filtered.map(d => <DeviceCard key={d.id} device={d} onDelete={handleDelete} />)}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-white font-semibold">Link Mobile App</h3>
                <p className="text-xs text-gray-500 mt-1">Scan QR or type the code in the mobile app</p>
              </div>
              <button
                onClick={handlePairing}
                disabled={pairingLoading}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-lg text-xs transition-colors"
              >
                {pairingLoading ? 'Generating...' : 'Generate'}
              </button>
            </div>

            {pairingError && (
              <div className="flex items-center gap-2 text-xs text-red-400 mb-3">
                <XCircle size={14} /> {pairingError}
              </div>
            )}

            {pairing ? (
              <div className="grid gap-4">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Pairing code</span>
                  <span className={pairingSeconds === 0 ? 'text-red-400' : ''}>{pairingCountdown}</span>
                </div>
                <div className="text-center bg-gray-950 border border-gray-800 rounded-lg py-3 font-mono text-2xl tracking-widest text-white">
                  {pairing.code}
                </div>
                <div className="flex items-center justify-center bg-white rounded-lg p-3">
                  {pairingQr ? (
                    <img src={pairingQr} alt="Pairing QR code" className="w-48 h-48" />
                  ) : (
                    <div className="text-xs text-gray-500">Generating QR...</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-xs text-gray-500">
                Generate a short-lived code to link a mobile device.
              </div>
            )}
          </div>

          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Register Device</h3>
              <span className="text-xs text-gray-500">Inventory</span>
            </div>

            <form onSubmit={handleAdd} className="space-y-3">
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Device name"
                className="w-full bg-gray-950 border border-gray-800 text-gray-300 text-sm rounded-lg px-3 py-2"
                required
              />
              <select
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value })}
                className="w-full bg-gray-950 border border-gray-800 text-gray-300 text-sm rounded-lg px-3 py-2"
              >
                {['mobile','endpoint','server','network','iot','other'].map(t => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
              <input
                type="text"
                value={form.platform}
                onChange={e => setForm({ ...form, platform: e.target.value })}
                placeholder="Platform (Android, iOS, Windows)"
                className="w-full bg-gray-950 border border-gray-800 text-gray-300 text-sm rounded-lg px-3 py-2"
              />
              <input
                type="text"
                value={form.os_version}
                onChange={e => setForm({ ...form, os_version: e.target.value })}
                placeholder="OS version"
                className="w-full bg-gray-950 border border-gray-800 text-gray-300 text-sm rounded-lg px-3 py-2"
              />
              <input
                type="text"
                value={form.owner}
                onChange={e => setForm({ ...form, owner: e.target.value })}
                placeholder="Owner or team"
                className="w-full bg-gray-950 border border-gray-800 text-gray-300 text-sm rounded-lg px-3 py-2"
              />
              <input
                type="text"
                value={form.ip}
                onChange={e => setForm({ ...form, ip: e.target.value })}
                placeholder="IP address"
                className="w-full bg-gray-950 border border-gray-800 text-gray-300 text-sm rounded-lg px-3 py-2"
              />

              {error && (
                <div className="flex items-center gap-2 text-xs text-red-400">
                  <XCircle size={14} /> {error}
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-lg text-sm transition-colors"
              >
                {saving ? 'Saving...' : 'Add Device'}
              </button>
              <div className="text-xs text-gray-500 flex items-center gap-2">
                <CheckCircle size={12} className="text-green-400" />
                Use the heartbeat API to keep mobile health updated.
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

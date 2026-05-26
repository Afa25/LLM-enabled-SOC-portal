import React, { useState, useEffect } from 'react';
import { useAuth, usePageState } from '../App';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import {
  ShieldAlert, Monitor, AlertTriangle, Activity, Clock,
  TrendingUp, CheckCircle, XCircle, Cpu, MemoryStick,
  HardDrive, Network, Wifi, AlertOctagon
} from 'lucide-react';

const LEVEL_COLORS = {
  critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e'
};

function StatCard({ icon: Icon, label, value, sub, color = 'blue', loading }) {
  const colors = {
    blue:   'bg-blue-600/10 text-blue-400 border-blue-600/20',
    red:    'bg-red-600/10  text-red-400  border-red-600/20',
    orange: 'bg-orange-600/10 text-orange-400 border-orange-600/20',
    green:  'bg-green-600/10 text-green-400 border-green-600/20',
    purple: 'bg-purple-600/10 text-purple-400 border-purple-600/20',
    cyan:   'bg-cyan-600/10 text-cyan-400 border-cyan-600/20',
  };
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-500 text-sm">{label}</p>
          {loading
            ? <div className="h-8 w-20 bg-gray-800 rounded animate-pulse mt-1" />
            : <p className="text-3xl font-bold text-white mt-1">{value ?? '—'}</p>
          }
          {sub && <p className="text-xs text-gray-600 mt-1">{sub}</p>}
        </div>
        <div className={`p-2.5 rounded-lg border ${colors[color]}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

// Gauge bar component used for Prometheus metrics
function GaugeBar({ label, value, unit = '%', color = '#3b82f6' }) {
  const pct = Math.min(Math.max(value ?? 0, 0), 100);
  const barColor = pct > 85 ? '#ef4444' : pct > 65 ? '#f97316' : color;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-white font-medium">
          {value != null ? `${value}${unit}` : '—'}
        </span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
    </div>
  );
}

const SURI_SEVERITY = { 1: { label: 'Critical', color: 'text-red-400' }, 2: { label: 'High', color: 'text-orange-400' }, 3: { label: 'Medium', color: 'text-yellow-400' } };

export default function Dashboard() {
  const { apiFetch } = useAuth();
  const [ps, setPs] = usePageState('dashboard', { stats: null, hours: 24, health: [], promData: null, suriData: null, zeekData: null, idsStats: null });
  const { stats, hours, health, promData, suriData, zeekData, idsStats } = ps;
  const [loading,    setLoading]    = useState(!ps.stats);
  const [netLoading, setNetLoading] = useState(!ps.promData);

  const setStats    = v => setPs(p => ({ ...p, stats:    typeof v === 'function' ? v(p.stats)    : v }));
  const setHours    = v => setPs(p => ({ ...p, hours:    typeof v === 'function' ? v(p.hours)    : v }));
  const setHealth   = v => setPs(p => ({ ...p, health:   typeof v === 'function' ? v(p.health)   : v }));
  const setPromData = v => setPs(p => ({ ...p, promData: typeof v === 'function' ? v(p.promData) : v }));
  const setSuriData = v => setPs(p => ({ ...p, suriData: typeof v === 'function' ? v(p.suriData) : v }));
  const setZeekData = v => setPs(p => ({ ...p, zeekData: typeof v === 'function' ? v(p.zeekData) : v }));
  const setIdsStats = v => setPs(p => ({ ...p, idsStats: typeof v === 'function' ? v(p.idsStats) : v }));

  async function load() {
    setLoading(true);
    const [res, hres] = await Promise.all([
      apiFetch(`/api/stats?hours=${hours}`),
      apiFetch('/api/health/endpoints')
    ]);
    const data  = await res?.json();
    const hdata = await hres?.json();
    setStats(data);
    setHealth(Array.isArray(hdata) ? hdata : []);
    setLoading(false);
  }

  async function loadNetdata() {
    setNetLoading(true);
    const [pr, sr, zr, ids] = await Promise.all([
      apiFetch('/api/netdata/prometheus'),
      apiFetch('/api/netdata/suricata'),
      apiFetch('/api/netdata/zeek'),
      apiFetch('/api/netdata/ids-stats'),
    ]);
    setPromData(await pr?.json());
    setSuriData(await sr?.json());
    setZeekData(await zr?.json());
    setIdsStats(await ids?.json());
    setNetLoading(false);
  }

  useEffect(() => {
    load();
    loadNetdata();
    const iv1 = setInterval(load, 60_000);
    const iv2 = setInterval(loadNetdata, 30_000);
    return () => { clearInterval(iv1); clearInterval(iv2); };
  }, [hours]);

  const byLevel  = stats?.summary?.by_level || [];
  const critical = byLevel.filter(b => b.key >= 12).reduce((s, b) => s + b.doc_count, 0);
  const high     = byLevel.filter(b => b.key >= 7 && b.key < 12).reduce((s, b) => s + b.doc_count, 0);

  const overTime = (stats?.summary?.over_time || []).map(b => ({
    time:   new Date(b.key_as_string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    alerts: b.doc_count
  }));

  const byGroup = (stats?.summary?.by_group || []).slice(0, 8).map(b => ({
    name:  b.key.length > 20 ? b.key.slice(0, 20) + '…' : b.key,
    count: b.doc_count
  }));

  const agentPie = (stats?.summary?.by_agent || []).slice(0, 5).map((b, i) => ({
    name:  b.key, value: b.doc_count,
    fill:  ['#3b82f6', '#8b5cf6', '#f97316', '#22c55e', '#ef4444'][i]
  }));

  // Format bytes nicely
  function fmtBytes(n) {
    if (n == null) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(1)} MB`;
  }

  function fmtUptime(s) {
    if (s == null) return '—';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-0.5">Real-time security operations overview</p>
        </div>
        <div className="flex gap-2">
          {[6, 24, 48, 168].map(h => (
            <button key={h} onClick={() => setHours(h)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${hours === h ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
              {h < 24 ? `${h}h` : h === 24 ? '24h' : h === 48 ? '2d' : '7d'}
            </button>
          ))}
          <button onClick={() => { load(); loadNetdata(); }} className="px-3 py-1.5 rounded-lg text-xs bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={ShieldAlert}   label="Total Alerts"       value={stats?.summary?.total}   sub={`Last ${hours}h`}            color="blue"   loading={loading} />
        <StatCard icon={AlertTriangle} label="Critical (Lv 12+)" value={critical}                 sub="Immediate attention required" color="red"    loading={loading} />
        <StatCard icon={TrendingUp}    label="High Severity"      value={high}                     sub="Investigation recommended"   color="orange" loading={loading} />
        <StatCard icon={Monitor}       label="Active Agents"      value={stats?.agents?.active}    sub={`${stats?.agents?.inactive || 0} inactive`} color="green" loading={loading} />
      </div>

      {/* Charts row */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Alert timeline */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-white font-semibold mb-4">Alert Volume Timeline</h3>
          {loading
            ? <div className="h-48 bg-gray-800 rounded animate-pulse" />
            : <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={overTime}>
                  <defs>
                    <linearGradient id="alertGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} labelStyle={{ color: '#9ca3af' }} itemStyle={{ color: '#60a5fa' }} />
                  <Area type="monotone" dataKey="alerts" stroke="#3b82f6" strokeWidth={2} fill="url(#alertGrad)" />
                </AreaChart>
              </ResponsiveContainer>
          }
        </div>

        {/* Alert categories */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-white font-semibold mb-4">Alert Categories</h3>
          {loading
            ? <div className="h-48 bg-gray-800 rounded animate-pulse" />
            : <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byGroup} layout="vertical">
                  <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} width={120} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} itemStyle={{ color: '#60a5fa' }} />
                  <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
          }
        </div>
      </div>

      {/* ── PROMETHEUS SYSTEM METRICS ────────────────────────────── */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-red-400" />
            <h3 className="text-white font-semibold">System Metrics</h3>
            <span className="text-xs text-gray-600 ml-1">via Prometheus</span>
          </div>
          {promData?.available === false && (
            <span className="text-xs text-gray-600 bg-gray-800 px-2 py-1 rounded">node-exporter offline</span>
          )}
        </div>

        {netLoading ? (
          <div className="h-24 bg-gray-800 rounded animate-pulse" />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Resource gauges */}
            <div className="space-y-4">
              <GaugeBar label="CPU Usage"    value={promData?.cpu_pct}  color="#3b82f6" />
              <GaugeBar label="Memory Usage" value={promData?.mem_pct}  color="#8b5cf6" />
              <GaugeBar label="Disk Usage"   value={promData?.disk_pct} color="#f97316" />
            </div>

            {/* Network throughput */}
            <div className="space-y-3">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Network</p>
              <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
                <Network size={16} className="text-blue-400 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Inbound</p>
                  <p className="text-sm font-medium text-white">
                    {promData?.net_rx_kbs != null ? `${promData.net_rx_kbs.toFixed(1)} KB/s` : '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
                <Network size={16} className="text-green-400 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">Outbound</p>
                  <p className="text-sm font-medium text-white">
                    {promData?.net_tx_kbs != null ? `${promData.net_tx_kbs.toFixed(1)} KB/s` : '—'}
                  </p>
                </div>
              </div>
            </div>

            {/* Uptime */}
            <div className="space-y-3">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Host</p>
              <div className="p-3 bg-gray-800/50 rounded-lg">
                <p className="text-xs text-gray-500">Uptime</p>
                <p className="text-lg font-bold text-white mt-0.5">{fmtUptime(promData?.uptime_s)}</p>
              </div>
              <div className="flex gap-2">
                <a href="/grafana/d/soc-metrics-dashboard" target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 flex-1 py-2 text-xs text-orange-400 border border-orange-900/40 rounded-lg hover:bg-orange-900/10 transition-colors">
                  Grafana →
                </a>
                <a href="/prometheus/" target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 flex-1 py-2 text-xs text-red-400 border border-red-900/40 rounded-lg hover:bg-red-900/10 transition-colors">
                  Prometheus →
                </a>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── SURICATA IDS ALERTS ───────────────────────────────────── */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertOctagon size={18} className="text-yellow-400" />
            <h3 className="text-white font-semibold">Suricata IDS Alerts</h3>
            <span className="text-xs text-gray-600 ml-1">live from eve.json</span>
          </div>
          {suriData?.available && (
            <a href="/grafana/d/soc-ids-dashboard" target="_blank" rel="noopener noreferrer"
               className="text-xs text-yellow-500 hover:text-yellow-400 transition-colors">
              Grafana dashboard →
            </a>
          )}
        </div>

        {netLoading ? (
          <div className="h-24 bg-gray-800 rounded animate-pulse" />
        ) : !suriData?.available ? (
          <div className="text-center py-8">
            <AlertOctagon size={28} className="text-gray-700 mx-auto mb-2" />
            <p className="text-gray-600 text-sm">Suricata log not found.</p>
            <p className="text-gray-700 text-xs mt-1">Requires Linux host · enable with: ./setup.sh packet-capture start</p>
          </div>
        ) : (
          <>
            {/* Summary stat strip */}
            {idsStats?.suricata?.available && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Total', value: idsStats.suricata.total, color: 'text-white' },
                  { label: 'Critical', value: idsStats.suricata.by_severity?.[1] ?? 0, color: 'text-red-400' },
                  { label: 'High',     value: idsStats.suricata.by_severity?.[2] ?? 0, color: 'text-orange-400' },
                  { label: 'Medium',   value: idsStats.suricata.by_severity?.[3] ?? 0, color: 'text-yellow-400' },
                ].map(s => (
                  <div key={s.label} className="bg-gray-800/60 rounded-lg p-3 text-center">
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="grid lg:grid-cols-3 gap-4">
              {/* Top categories */}
              {idsStats?.suricata?.top_categories?.length > 0 && (
                <div className="lg:col-span-1">
                  <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">Top Categories</p>
                  <div className="space-y-1.5">
                    {idsStats.suricata.top_categories.slice(0, 5).map((c, i) => {
                      const max = idsStats.suricata.top_categories[0].count;
                      const pct = Math.round((c.count / max) * 100);
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-gray-400 truncate max-w-[160px]">{c.cat}</span>
                            <span className="text-gray-300 ml-2 flex-shrink-0">{c.count}</span>
                          </div>
                          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full rounded-full bg-yellow-500/60" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Alerts table */}
              <div className={idsStats?.suricata?.top_categories?.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}>
                {suriData.alerts.length === 0 ? (
                  <p className="text-gray-600 text-sm text-center py-6">No alerts in current log window.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-800">
                          <th className="text-left py-2 pr-3 font-medium">Time</th>
                          <th className="text-left py-2 pr-3 font-medium">Src</th>
                          <th className="text-left py-2 pr-3 font-medium">Dest</th>
                          <th className="text-left py-2 pr-3 font-medium">Signature</th>
                          <th className="text-left py-2 font-medium">Sev</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suriData.alerts.slice(0, 12).map((a, i) => {
                          const sev = SURI_SEVERITY[a.severity] || { label: `${a.severity}`, color: 'text-gray-400' };
                          return (
                            <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                              <td className="py-1.5 pr-3 text-gray-500 whitespace-nowrap">
                                {a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : '—'}
                              </td>
                              <td className="py-1.5 pr-3 text-gray-300 font-mono">{a.src_ip ?? '—'}</td>
                              <td className="py-1.5 pr-3 text-gray-300 font-mono">{a.dest_ip ?? '—'}</td>
                              <td className="py-1.5 pr-3 text-gray-200 max-w-xs truncate">{a.signature ?? '—'}</td>
                              <td className={`py-1.5 font-medium ${sev.color}`}>{sev.label}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── ZEEK NETWORK CONNECTIONS ──────────────────────────────── */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Wifi size={18} className="text-cyan-400" />
            <h3 className="text-white font-semibold">Zeek Network Activity</h3>
            <span className="text-xs text-gray-600 ml-1">live from conn.log</span>
          </div>
          {zeekData?.available && (
            <a href="/grafana/d/soc-ids-dashboard" target="_blank" rel="noopener noreferrer"
               className="text-xs text-cyan-500 hover:text-cyan-400 transition-colors">
              Grafana dashboard →
            </a>
          )}
        </div>

        {netLoading ? (
          <div className="h-24 bg-gray-800 rounded animate-pulse" />
        ) : !zeekData?.available ? (
          <div className="text-center py-8">
            <Wifi size={28} className="text-gray-700 mx-auto mb-2" />
            <p className="text-gray-600 text-sm">Zeek log not found.</p>
            <p className="text-gray-700 text-xs mt-1">Requires Linux host · enable with: ./setup.sh packet-capture start</p>
          </div>
        ) : (
          <>
            {/* Summary strip */}
            {idsStats?.zeek?.available && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Connections', value: idsStats.zeek.total },
                  { label: 'Unique Src IPs', value: idsStats.zeek.unique_src },
                  { label: 'Bytes In',  value: fmtBytes(idsStats.zeek.bytes_in) },
                  { label: 'Bytes Out', value: fmtBytes(idsStats.zeek.bytes_out) },
                ].map(s => (
                  <div key={s.label} className="bg-gray-800/60 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-cyan-300">{s.value ?? '—'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="grid lg:grid-cols-3 gap-4">
              {/* Protocol breakdown */}
              {idsStats?.zeek?.by_proto && Object.keys(idsStats.zeek.by_proto).length > 0 && (
                <div className="lg:col-span-1">
                  <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-2">Protocols</p>
                  <div className="space-y-1.5">
                    {Object.entries(idsStats.zeek.by_proto)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 6)
                      .map(([proto, count], i) => {
                        const total = Object.values(idsStats.zeek.by_proto).reduce((s, v) => s + v, 0);
                        const pct = Math.round((count / total) * 100);
                        const colors = ['bg-cyan-500/60', 'bg-blue-500/60', 'bg-purple-500/60', 'bg-green-500/60', 'bg-yellow-500/60', 'bg-pink-500/60'];
                        return (
                          <div key={proto}>
                            <div className="flex justify-between text-xs mb-0.5">
                              <span className="text-gray-400 uppercase font-medium">{proto}</span>
                              <span className="text-gray-300">{count} <span className="text-gray-600">({pct}%)</span></span>
                            </div>
                            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${colors[i % colors.length]}`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Connections table */}
              <div className={idsStats?.zeek?.by_proto && Object.keys(idsStats.zeek.by_proto).length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}>
                {zeekData.connections.length === 0 ? (
                  <p className="text-gray-600 text-sm text-center py-6">No connections in current log window.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500 border-b border-gray-800">
                          <th className="text-left py-2 pr-3 font-medium">Time</th>
                          <th className="text-left py-2 pr-3 font-medium">Src</th>
                          <th className="text-left py-2 pr-3 font-medium">Dest</th>
                          <th className="text-left py-2 pr-3 font-medium">Proto</th>
                          <th className="text-left py-2 pr-3 font-medium">Service</th>
                          <th className="text-left py-2 pr-3 font-medium">↓</th>
                          <th className="text-left py-2 font-medium">↑</th>
                        </tr>
                      </thead>
                      <tbody>
                        {zeekData.connections.slice(0, 12).map((c, i) => {
                          const ts = c.ts
                            ? (typeof c.ts === 'number' || /^\d+(\.\d+)?$/.test(c.ts))
                              ? new Date(parseFloat(c.ts) * 1000).toLocaleTimeString()
                              : new Date(c.ts).toLocaleTimeString()
                            : '—';
                          return (
                            <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                              <td className="py-1.5 pr-3 text-gray-500 whitespace-nowrap">{ts}</td>
                              <td className="py-1.5 pr-3 text-gray-300 font-mono">{c.src_ip}:{c.src_port}</td>
                              <td className="py-1.5 pr-3 text-gray-300 font-mono">{c.dest_ip}:{c.dest_port}</td>
                              <td className="py-1.5 pr-3 text-cyan-400 uppercase font-medium">{c.proto ?? '—'}</td>
                              <td className="py-1.5 pr-3 text-gray-400">{c.service && c.service !== '-' ? c.service : '—'}</td>
                              <td className="py-1.5 pr-3 text-gray-400">{fmtBytes(c.bytes_in)}</td>
                              <td className="py-1.5 text-gray-400">{fmtBytes(c.bytes_out)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bottom row */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Agent breakdown */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h3 className="text-white font-semibold mb-4">Alerts by Endpoint</h3>
          {agentPie.length > 0
            ? <>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={agentPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} innerRadius={35}>
                      {agentPie.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }} itemStyle={{ color: '#fff' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-2">
                  {agentPie.map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ background: e.fill }} />
                        <span className="text-gray-400 truncate max-w-[120px]">{e.name}</span>
                      </div>
                      <span className="text-gray-300 font-medium">{e.value}</span>
                    </div>
                  ))}
                </div>
              </>
            : <p className="text-gray-600 text-sm text-center py-12">No data</p>
          }
        </div>

        {/* Agent status */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">Agent Status</h3>
            <span className="text-xs text-gray-500">{stats?.agents?.total || 0} total</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 text-center">
              <CheckCircle size={24} className="text-green-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-green-400">{stats?.agents?.active || 0}</p>
              <p className="text-xs text-gray-500 mt-1">Active</p>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center">
              <XCircle size={24} className="text-red-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-red-400">{stats?.agents?.inactive || 0}</p>
              <p className="text-xs text-gray-500 mt-1">Inactive / Disconnected</p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 p-3 bg-gray-800 rounded-lg">
            <Activity size={16} className="text-blue-400 flex-shrink-0" />
            <p className="text-xs text-gray-400">
              Wazuh Manager: <span className="text-white font-medium">{stats?.manager?.name || 'Connected'}</span>
              {' · '}Version: <span className="text-white font-medium">{stats?.manager?.version || '—'}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Endpoint health via SNMP */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Endpoint Health (SNMP)</h3>
          <span className="text-xs text-gray-500">{health.length} endpoints</span>
        </div>
        {loading ? (
          <div className="h-28 bg-gray-800 rounded animate-pulse" />
        ) : health.length === 0 ? (
          <p className="text-gray-600 text-sm">No SNMP endpoints found. Ensure SNMP targets are configured.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {health.map(h => (
              <div key={h.instance} className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{h.instance}</p>
                  <p className="text-xs text-gray-500">scrape: {h.scrape_seconds.toFixed(2)}s</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                  h.status === 'up'
                    ? 'bg-green-500/10 text-green-400 border-green-500/20'
                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                }`}>
                  {h.status.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

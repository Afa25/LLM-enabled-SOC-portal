import React, { useState, useEffect } from 'react';
import { useAuth } from '../App';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { ShieldAlert, Monitor, AlertTriangle, Activity, Clock, TrendingUp, CheckCircle, XCircle } from 'lucide-react';

const LEVEL_COLORS = {
  critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e'
};

function StatCard({ icon: Icon, label, value, sub, color = 'blue', loading }) {
  const colors = {
    blue:   'bg-blue-600/10 text-blue-400 border-blue-600/20',
    red:    'bg-red-600/10  text-red-400  border-red-600/20',
    orange: 'bg-orange-600/10 text-orange-400 border-orange-600/20',
    green:  'bg-green-600/10 text-green-400 border-green-600/20',
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

export default function Dashboard() {
  const { apiFetch } = useAuth();
  const [stats,   setStats]   = useState(null);
  const [hours,   setHours]   = useState(24);
  const [loading, setLoading] = useState(true);
  const [health,  setHealth]  = useState([]);

  async function load() {
    setLoading(true);
    const [res, hres] = await Promise.all([
      apiFetch(`/api/stats?hours=${hours}`),
      apiFetch('/api/health/endpoints')
    ]);
    const data = await res?.json();
    const hdata = await hres?.json();
    setStats(data);
    setHealth(Array.isArray(hdata) ? hdata : []);
    setLoading(false);
  }

  useEffect(() => { load(); const iv = setInterval(load, 60_000); return () => clearInterval(iv); }, [hours]);

  const byLevel = stats?.summary?.by_level || [];
  const critical = byLevel.filter(b => b.key >= 12).reduce((s,b) => s+b.doc_count, 0);
  const high     = byLevel.filter(b => b.key >= 7 && b.key < 12).reduce((s,b) => s+b.doc_count, 0);

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
    fill:  ['#3b82f6','#8b5cf6','#f97316','#22c55e','#ef4444'][i]
  }));

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
          <button onClick={load} className="px-3 py-1.5 rounded-lg text-xs bg-gray-800 text-gray-400 hover:bg-gray-700 transition-colors">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={ShieldAlert}   label="Total Alerts"         value={stats?.summary?.total}    sub={`Last ${hours}h`}             color="blue"   loading={loading} />
        <StatCard icon={AlertTriangle} label="Critical (Lv 12+)"   value={critical}                 sub="Immediate attention required"  color="red"    loading={loading} />
        <StatCard icon={TrendingUp}    label="High Severity"        value={high}                     sub="Investigation recommended"     color="orange" loading={loading} />
        <StatCard icon={Monitor}       label="Active Agents"        value={stats?.agents?.active}    sub={`${stats?.agents?.inactive || 0} inactive`} color="green" loading={loading} />
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

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth, usePageState } from '../App';
import { ShieldBan, AlertTriangle, Server, Cpu, RefreshCw, Ban, Clock, Globe } from 'lucide-react';

function StatCard({ icon: Icon, label, value, color = 'blue' }) {
  const colors = {
    blue:   'bg-blue-500/10 text-blue-400 border-blue-500/20',
    red:    'bg-red-500/10  text-red-400  border-red-500/20',
    yellow: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    green:  'bg-green-500/10 text-green-400 border-green-500/20',
  };
  return (
    <div className={`rounded-xl border p-5 flex items-center gap-4 ${colors[color]}`}>
      <div className="p-2 rounded-lg bg-current/10">
        <Icon size={22} />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value ?? '—'}</p>
        <p className="text-xs mt-0.5 opacity-70">{label}</p>
      </div>
    </div>
  );
}

function Badge({ text, color }) {
  const cls = {
    red:    'bg-red-500/20 text-red-300',
    yellow: 'bg-yellow-500/20 text-yellow-300',
    green:  'bg-green-500/20 text-green-300',
    gray:   'bg-gray-500/20 text-gray-300',
  }[color] || 'bg-gray-500/20 text-gray-300';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{text}</span>;
}

function relativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function expiresIn(iso) {
  if (!iso) return 'permanent';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function CrowdSec() {
  const { apiFetch } = useAuth();
  const [ps, setPs] = usePageState('crowdsec', { summary: null, decisions: [], alerts: [], tab: 'decisions' });
  const { summary, decisions, alerts, tab } = ps;
  const [loading, setLoading] = useState(!ps.summary);
  const [error,   setError]   = useState(null);

  const setSummary   = v => setPs(p => ({ ...p, summary:   typeof v === 'function' ? v(p.summary)   : v }));
  const setDecisions = v => setPs(p => ({ ...p, decisions: typeof v === 'function' ? v(p.decisions) : v }));
  const setAlerts    = v => setPs(p => ({ ...p, alerts:    typeof v === 'function' ? v(p.alerts)    : v }));
  const setTab       = v => setPs(p => ({ ...p, tab:       typeof v === 'function' ? v(p.tab)       : v }));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sumRes, decRes, altRes] = await Promise.all([
        apiFetch('/api/crowdsec/summary'),
        apiFetch('/api/crowdsec/decisions'),
        apiFetch('/api/crowdsec/alerts'),
      ]);
      if (sumRes) setSummary(await sumRes.json());
      if (decRes) setDecisions(await decRes.json());
      if (altRes) setAlerts(await altRes.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ShieldBan size={24} className="text-orange-400" />
            CrowdSec
          </h1>
          <p className="text-gray-400 text-sm mt-1">Collaborative threat intelligence &amp; IP blocking</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Ban}           label="Active Bans"       value={summary?.active_decisions} color="red"    />
        <StatCard icon={AlertTriangle} label="Nginx Lines Read"  value={summary?.nginx_lines_read} color="yellow" />
        <StatCard icon={Server}        label="Machines"          value={summary?.machines}          color="blue"   />
        <StatCard icon={Cpu}           label="Bouncers"          value={summary?.bouncers}          color="green"  />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1 w-fit">
        {['decisions', 'alerts'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
              tab === t ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}>
            {t === 'decisions' ? `Active Bans (${decisions.length})` : `Alerts (${alerts.length})`}
          </button>
        ))}
      </div>

      {/* Decisions table */}
      {tab === 'decisions' && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
          {decisions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <Ban size={36} className="mb-3 opacity-30" />
              <p className="text-sm">No active bans</p>
              <p className="text-xs mt-1 opacity-60">CrowdSec hasn't blocked any IPs yet</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3">IP / Scope</th>
                  <th className="text-left px-4 py-3">Type</th>
                  <th className="text-left px-4 py-3">Reason</th>
                  <th className="text-left px-4 py-3">Origin</th>
                  <th className="text-left px-4 py-3">Expires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {decisions.map((d, i) => (
                  <tr key={d.id ?? i} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-orange-300">{d.value}</td>
                    <td className="px-4 py-3">
                      <Badge text={d.type || 'ban'} color="red" />
                    </td>
                    <td className="px-4 py-3 text-gray-300 max-w-xs truncate">{d.scenario || '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{d.origin || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 flex items-center gap-1">
                      <Clock size={12} />
                      {expiresIn(d.until)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Alerts table */}
      {tab === 'alerts' && (
        <div className="bg-gray-800/50 rounded-xl border border-gray-700 overflow-hidden">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <AlertTriangle size={36} className="mb-3 opacity-30" />
              <p className="text-sm">No alerts yet</p>
              <p className="text-xs mt-1 opacity-60">Alerts will appear as CrowdSec detects attack patterns</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Scenario / Reason</th>
                  <th className="text-left px-4 py-3">Origin</th>
                  <th className="text-left px-4 py-3">Action</th>
                  <th className="text-left px-4 py-3">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {alerts.map((a, i) => (
                  <tr key={i} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-4 py-3 text-yellow-300 max-w-xs truncate">{a.reason || '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{a.origin || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge text={a.action || 'alert'} color={a.action === 'ban' ? 'red' : 'yellow'} />
                    </td>
                    <td className="px-4 py-3 text-gray-300 font-mono">{a.count ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

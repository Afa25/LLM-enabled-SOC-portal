import React, { useState, useEffect } from 'react';
import { usePageState } from '../App';
import { useAuth } from '../App';
import { ShieldAlert, ChevronDown, ChevronUp, Filter, RefreshCw } from 'lucide-react';

const LEVEL_META = {
  12: { label: 'Critical', bg: 'bg-red-500/10',     text: 'text-red-400',    border: 'border-red-500/20',    dot: 'bg-red-500'    },
  10: { label: 'High',     bg: 'bg-orange-500/10',  text: 'text-orange-400', border: 'border-orange-500/20', dot: 'bg-orange-500' },
  7:  { label: 'Medium',   bg: 'bg-yellow-500/10',  text: 'text-yellow-400', border: 'border-yellow-500/20', dot: 'bg-yellow-500' },
  3:  { label: 'Low',      bg: 'bg-green-500/10',   text: 'text-green-400',  border: 'border-green-500/20',  dot: 'bg-green-500'  },
  0:  { label: 'Info',     bg: 'bg-gray-800',       text: 'text-gray-400',   border: 'border-gray-700',      dot: 'bg-gray-600'   },
};

function lm(lvl) {
  if (lvl >= 12) return LEVEL_META[12];
  if (lvl >= 10) return LEVEL_META[10];
  if (lvl >= 7)  return LEVEL_META[7];
  if (lvl >= 3)  return LEVEL_META[3];
  return LEVEL_META[0];
}

function AlertRow({ alert }) {
  const [open, setOpen] = useState(false);
  const meta = lm(alert?.rule?.level || 0);
  const ts   = alert?.timestamp ? new Date(alert.timestamp).toLocaleString() : '—';

  return (
    <div className="border-b border-gray-800 last:border-0">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/40 transition-colors text-left">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${meta.dot}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white truncate">{alert?.rule?.description || 'Unknown rule'}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {alert?.agent?.name || 'unknown'} · Rule {alert?.rule?.id} · {ts}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 border ${meta.bg} ${meta.text} ${meta.border}`}>
          Lv {alert?.rule?.level ?? '?'} · {meta.label}
        </span>
        {open ? <ChevronUp size={14} className="text-gray-500 flex-shrink-0" /> : <ChevronDown size={14} className="text-gray-500 flex-shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 bg-gray-800/20">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs pt-2">
            {[['Rule ID', alert?.rule?.id], ['Agent', alert?.agent?.name], ['Agent IP', alert?.agent?.ip], ['Timestamp', ts]].map(([k, v]) => (
              <div key={k}>
                <p className="text-gray-500 mb-0.5">{k}</p>
                <p className="text-gray-200 font-mono">{v || '—'}</p>
              </div>
            ))}
          </div>
          {alert?.rule?.mitre?.technique?.length > 0 && (
            <div>
              <p className="text-gray-500 text-xs mb-1">MITRE ATT&CK Techniques</p>
              <div className="flex flex-wrap gap-1">
                {alert.rule.mitre.technique.map(t => (
                  <span key={t} className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs rounded font-mono">{t}</span>
                ))}
              </div>
            </div>
          )}
          {alert?.data && Object.keys(alert.data).length > 0 && (
            <div>
              <p className="text-gray-500 text-xs mb-1">Event Data</p>
              <pre className="text-xs text-gray-400 bg-gray-950 rounded-lg p-3 overflow-x-auto max-h-48 font-mono">
                {JSON.stringify(alert.data, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Alerts() {
  const { apiFetch } = useAuth();
  const [ps, setPs] = usePageState('alerts', { alerts: [], level: '', limit: '100', from: '', to: '' });
  const { alerts, level, limit, from, to } = ps;
  const [loading, setLoading] = useState(!ps.alerts.length);

  const setAlerts = v => setPs(p => ({ ...p, alerts: typeof v === 'function' ? v(p.alerts) : v }));
  const setLevel  = v => setPs(p => ({ ...p, level:  typeof v === 'function' ? v(p.level)  : v }));
  const setLimit  = v => setPs(p => ({ ...p, limit:  typeof v === 'function' ? v(p.limit)  : v }));
  const setFrom   = v => setPs(p => ({ ...p, from:   typeof v === 'function' ? v(p.from)   : v }));
  const setTo     = v => setPs(p => ({ ...p, to:     typeof v === 'function' ? v(p.to)     : v }));

  async function load() {
    setLoading(true);
    const p = new URLSearchParams({ limit });
    if (level) p.set('level', level);
    if (from)  p.set('from', new Date(from).toISOString());
    if (to)    p.set('to',   new Date(to).toISOString());
    const res  = await apiFetch(`/api/alerts?${p}`);
    const data = await res?.json();
    setAlerts(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [level, limit, from, to]);

  const counts = alerts.reduce((acc, a) => {
    const l = a?.rule?.level || 0;
    if (l >= 12) acc.critical++;
    else if (l >= 10) acc.high++;
    else if (l >= 7)  acc.medium++;
    else acc.low++;
    return acc;
  }, { critical: 0, high: 0, medium: 0, low: 0 });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Alerts</h1>
          <p className="text-gray-500 text-sm mt-0.5">Live security events from Wazuh SIEM</p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Severity chips */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: `${alerts.length} Total`,         cls: 'border-gray-700 text-gray-300'         },
          { label: `${counts.critical} Critical`,    cls: 'border-red-500/30 text-red-400'        },
          { label: `${counts.high} High`,            cls: 'border-orange-500/30 text-orange-400'  },
          { label: `${counts.medium} Medium`,        cls: 'border-yellow-500/30 text-yellow-400'  },
          { label: `${counts.low} Low/Info`,         cls: 'border-green-500/30 text-green-400'    },
        ].map(({ label, cls }) => (
          <span key={label} className={`px-3 py-1.5 rounded-lg border bg-gray-900 text-sm font-medium ${cls}`}>{label}</span>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center bg-gray-900 p-3 rounded-xl border border-gray-800">
        <Filter size={15} className="text-gray-500" />
        <span className="text-gray-500 text-sm">Filter:</span>
        <select value={level} onChange={e => setLevel(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500">
          <option value="">All Severity Levels</option>
          <option value="12">Critical (Level 12+)</option>
          <option value="10">High (Level 10+)</option>
          <option value="7">Medium (Level 7+)</option>
          <option value="3">Low (Level 3+)</option>
        </select>
        <select value={limit} onChange={e => setLimit(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500">
          <option value="50">50 results</option>
          <option value="100">100 results</option>
          <option value="200">200 results</option>
          <option value="500">500 results</option>
        </select>
        <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
          title="From date" />
        <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
          title="To date" />
        {(from || to) && (
          <button onClick={() => { setFrom(''); setTo(''); }}
            className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-400 text-xs rounded-lg transition-colors">
            ✕ Clear dates
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {loading ? (
          [...Array(10)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 last:border-0">
              <div className="w-2.5 h-2.5 rounded-full bg-gray-800" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-gray-800 rounded animate-pulse w-2/3" />
                <div className="h-2.5 bg-gray-800 rounded animate-pulse w-1/3" />
              </div>
              <div className="h-5 w-24 bg-gray-800 rounded animate-pulse" />
            </div>
          ))
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-600">
            <ShieldAlert size={44} className="mb-3 opacity-30" />
            <p className="font-medium text-gray-500">No alerts found</p>
            <p className="text-sm mt-1">Adjust filters or check Wazuh connectivity</p>
          </div>
        ) : (
          alerts.map((a, i) => <AlertRow key={i} alert={a} />)
        )}
      </div>
    </div>
  );
}

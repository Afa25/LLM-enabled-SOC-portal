import React, { useState, useEffect, useCallback } from 'react';
import { useAuth, usePageState } from '../App';
import {
  ShieldAlert, ShieldCheck, ShieldQuestion, Brain, Loader,
  CheckCircle, XCircle, RefreshCw, ChevronRight, AlertTriangle,
  Zap, Clock, Target, Activity
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────
const VERDICT_META = {
  true_positive:  { label: 'True Positive',  color: 'red',    icon: ShieldAlert  },
  false_positive: { label: 'False Positive', color: 'green',  icon: ShieldCheck  },
  needs_review:   { label: 'Needs Review',   color: 'yellow', icon: ShieldQuestion },
};

const COLOR = {
  red:    { bg: 'bg-red-500/10',    border: 'border-red-500/30',    text: 'text-red-400',    bar: 'bg-red-500'    },
  green:  { bg: 'bg-green-500/10',  border: 'border-green-500/30',  text: 'text-green-400',  bar: 'bg-green-500'  },
  yellow: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400', bar: 'bg-yellow-500' },
  blue:   { bg: 'bg-blue-500/10',   border: 'border-blue-500/20',   text: 'text-blue-400',   bar: 'bg-blue-500'   },
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400', bar: 'bg-purple-500' },
};

function levelColor(lvl) {
  if (lvl >= 12) return 'bg-red-500';
  if (lvl >= 7)  return 'bg-orange-500';
  return 'bg-yellow-500';
}

function fmtTime(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

// ── Stat card ─────────────────────────────────────────────────
function Stat({ icon: Icon, label, value, color = 'blue' }) {
  const c = COLOR[color];
  return (
    <div className={`flex items-center gap-3 p-4 rounded-xl border ${c.bg} ${c.border}`}>
      <div className={`p-2 rounded-lg ${c.bg}`}>
        <Icon size={18} className={c.text} />
      </div>
      <div>
        <p className="text-gray-400 text-xs">{label}</p>
        <p className={`text-xl font-bold ${c.text}`}>{value}</p>
      </div>
    </div>
  );
}

// ── Verdict badge ─────────────────────────────────────────────
function VerdictBadge({ verdict }) {
  const m = VERDICT_META[verdict] || VERDICT_META.needs_review;
  const c = COLOR[m.color];
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${c.bg} ${c.border} ${c.text}`}>
      <Icon size={12} /> {m.label}
    </span>
  );
}

// ── Confidence bar ────────────────────────────────────────────
function ConfidenceBar({ value, verdict }) {
  const c = COLOR[VERDICT_META[verdict]?.color || 'blue'];
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${c.bar} transition-all duration-500`} style={{ width: `${value}%` }} />
      </div>
      <span className={`text-xs font-medium ${c.text} w-10 text-right`}>{value}%</span>
    </div>
  );
}

// ── Alert queue card ──────────────────────────────────────────
function QueueCard({ alert, result, analyzing, onAnalyze, onReview }) {
  const lvl   = alert?.rule?.level || 0;
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);

  function handleReview(status) {
    onReview(result.id, status, showNote ? note : '');
    setShowNote(false);
    setNote('');
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden hover:border-gray-700 transition-colors">
      {/* Severity strip */}
      <div className={`h-1 w-full ${levelColor(lvl)}`} />

      <div className="p-4 space-y-3">
        {/* Alert header */}
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 px-2 py-0.5 rounded text-xs font-bold text-white flex-shrink-0 ${levelColor(lvl)}`}>
            L{lvl}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium leading-snug line-clamp-2">
              {alert?.rule?.description || 'Unknown rule'}
            </p>
            <div className="flex items-center gap-3 mt-1 text-gray-500 text-xs">
              <span>{alert?.agent?.name || '—'}</span>
              <span>·</span>
              <span>{fmtTime(alert?.timestamp)}</span>
            </div>
          </div>
        </div>

        {/* Groups */}
        {alert?.rule?.groups?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {[].concat(alert.rule.groups).slice(0, 4).map(g => (
              <span key={g} className="px-1.5 py-0.5 bg-gray-800 text-gray-400 text-xs rounded">
                {g}
              </span>
            ))}
          </div>
        )}

        {/* ── AI result ── */}
        {result ? (
          <div className="space-y-3 pt-1 border-t border-gray-800">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <VerdictBadge verdict={result.verdict} />
              <ConfidenceBar value={result.confidence} verdict={result.verdict} />
            </div>

            <p className="text-gray-300 text-sm leading-relaxed">{result.explanation}</p>

            {result.mitre_tactic && (
              <div className="flex items-center gap-2 text-xs">
                <Target size={12} className="text-purple-400 flex-shrink-0" />
                <span className="text-purple-300 font-mono">{result.mitre_tactic}</span>
              </div>
            )}

            <div className="flex items-start gap-2 p-2.5 bg-gray-800 rounded-lg">
              <ChevronRight size={13} className="text-blue-400 mt-0.5 flex-shrink-0" />
              <p className="text-gray-300 text-xs leading-relaxed">{result.recommended_action}</p>
            </div>

            {/* Analyst actions */}
            {result.analyst_status === 'pending' ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    onClick={() => handleReview('confirmed')}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-600/20 hover:bg-green-600/30 border border-green-600/30 text-green-400 text-xs rounded-lg transition-colors"
                  >
                    <CheckCircle size={13} /> Confirm
                  </button>
                  <button
                    onClick={() => handleReview('dismissed')}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded-lg transition-colors"
                  >
                    <XCircle size={13} /> Dismiss
                  </button>
                </div>
                <button
                  onClick={() => setShowNote(v => !v)}
                  className="text-gray-600 hover:text-gray-400 text-xs transition-colors"
                >
                  {showNote ? 'Hide note' : '+ Add analyst note'}
                </button>
                {showNote && (
                  <textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="Optional note for the record…"
                    rows={2}
                    className="w-full bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 resize-none"
                  />
                )}
              </div>
            ) : (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${
                result.analyst_status === 'confirmed'
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-gray-800 text-gray-500'
              }`}>
                {result.analyst_status === 'confirmed'
                  ? <><CheckCircle size={12} /> Confirmed by analyst</>
                  : <><XCircle size={12} /> Dismissed</>
                }
                {result.analyst_note && <span className="ml-1 text-gray-500">— {result.analyst_note}</span>}
              </div>
            )}
          </div>
        ) : analyzing ? (
          <div className="flex items-center gap-2 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
            <Loader size={14} className="text-purple-400 animate-spin flex-shrink-0" />
            <p className="text-purple-300 text-xs">Analyzing with local AI…</p>
          </div>
        ) : (
          <button
            onClick={() => onAnalyze(alert)}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded-lg font-medium transition-colors"
          >
            <Brain size={14} /> Analyze with AI
          </button>
        )}
      </div>
    </div>
  );
}

// ── Result card (Results tab) ─────────────────────────────────
function ResultCard({ result }) {
  const alert = result.alert_data || {};
  const lvl   = alert?.rule?.level || 0;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className={`h-1 w-full ${levelColor(lvl)}`} />
      <div className="p-4 space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-white text-sm font-medium line-clamp-2 flex-1">
            {alert?.rule?.description || 'Unknown rule'}
          </p>
          <VerdictBadge verdict={result.verdict} />
        </div>

        <ConfidenceBar value={result.confidence} verdict={result.verdict} />

        <p className="text-gray-400 text-xs leading-relaxed line-clamp-3">{result.explanation}</p>

        {result.mitre_tactic && (
          <p className="text-purple-400 text-xs font-mono">{result.mitre_tactic}</p>
        )}

        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>{alert?.agent?.name || '—'}</span>
          <span className={result.analyst_status !== 'pending' ? 'text-green-500' : ''}>
            {result.analyst_status}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function Triage() {
  const { apiFetch } = useAuth();
  const [ps, setPs] = usePageState('triage', { queue: [], results: [], tab: 'queue', filter: 'all' });
  const { queue, results, tab, filter } = ps;
  const [loading,  setLoading]  = useState(!ps.queue.length && !ps.results.length);
  const [analyzing, setAnalyzing] = useState(new Set());
  const [analyzeAllRunning, setAnalyzeAllRunning] = useState(false);
  const [analyzeAllProgress, setAnalyzeAllProgress] = useState({ done: 0, total: 0 });

  const setQueue   = v => setPs(p => ({ ...p, queue:   typeof v === 'function' ? v(p.queue)   : v }));
  const setResults = v => setPs(p => ({ ...p, results: typeof v === 'function' ? v(p.results) : v }));
  const setTab     = v => setPs(p => ({ ...p, tab:     typeof v === 'function' ? v(p.tab)     : v }));
  const setFilter  = v => setPs(p => ({ ...p, filter:  typeof v === 'function' ? v(p.filter)  : v }));

  const load = useCallback(async () => {
    setLoading(true);
    const [qRes, rRes] = await Promise.all([
      apiFetch('/api/triage/queue'),
      apiFetch('/api/triage')
    ]);
    const q = await qRes?.json().catch(() => []);
    const r = await rRes?.json().catch(() => []);
    setQueue(Array.isArray(q) ? q : []);
    setResults(Array.isArray(r) ? r : []);
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  async function analyzeAlert(alert) {
    setAnalyzing(prev => new Set(prev).add(alert._id));
    try {
      const res  = await apiFetch('/api/triage/analyze', {
        method: 'POST',
        body  : JSON.stringify(alert)
      });
      const data = await res?.json();
      if (data && !data.error) {
        setResults(prev => {
          const filtered = prev.filter(r => r.alert_id !== alert._id);
          return [data, ...filtered];
        });
      }
    } finally {
      setAnalyzing(prev => { const s = new Set(prev); s.delete(alert._id); return s; });
    }
  }

  async function analyzeAll() {
    const pending = queue.filter(a => a._id && !results.find(r => r.alert_id === a._id));
    if (!pending.length) return;
    setAnalyzeAllRunning(true);
    setAnalyzeAllProgress({ done: 0, total: pending.length });
    for (let i = 0; i < pending.length; i++) {
      await analyzeAlert(pending[i]);
      setAnalyzeAllProgress({ done: i + 1, total: pending.length });
    }
    setAnalyzeAllRunning(false);
  }

  async function reviewResult(id, status, note) {
    const res  = await apiFetch(`/api/triage/${id}`, {
      method: 'PATCH',
      body  : JSON.stringify({ analyst_status: status, analyst_note: note })
    });
    const data = await res?.json();
    if (data && !data.error) {
      setResults(prev => prev.map(r => r.id === id ? data : r));
    }
  }

  // Stats
  const analyzed   = results.length;
  const tpCount    = results.filter(r => r.verdict === 'true_positive').length;
  const tpRate     = analyzed ? Math.round((tpCount / analyzed) * 100) : 0;
  const avgConf    = analyzed
    ? Math.round(results.reduce((s, r) => s + r.confidence, 0) / analyzed)
    : 0;

  // Results filter
  const FILTER_OPTS = ['all', 'true_positive', 'false_positive', 'needs_review', 'confirmed', 'dismissed'];
  const filteredResults = results.filter(r => {
    if (filter === 'all') return true;
    if (['confirmed', 'dismissed'].includes(filter)) return r.analyst_status === filter;
    return r.verdict === filter;
  });

  // For queue: merge results so cards that are already analyzed show inline
  const resultMap = new Map(results.map(r => [r.alert_id, r]));

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Alert Triage</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Local LLM analyzes high-severity alerts — no data leaves your server
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={analyzeAll}
            disabled={analyzeAllRunning || queue.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {analyzeAllRunning
              ? <><Loader size={14} className="animate-spin" /> {analyzeAllProgress.done}/{analyzeAllProgress.total}</>
              : <><Zap size={14} /> Analyze All</>
            }
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={AlertTriangle} label="In Queue"        value={queue.length}         color="yellow" />
        <Stat icon={Brain}         label="Analyzed"         value={analyzed}             color="purple" />
        <Stat icon={ShieldAlert}   label="True Positive %"  value={`${tpRate}%`}         color="red"    />
        <Stat icon={Activity}      label="Avg Confidence"   value={`${avgConf}%`}        color="blue"   />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-900 rounded-lg border border-gray-800 w-fit">
        {[
          { id: 'queue',   label: `Queue (${queue.filter(a => !resultMap.has(a._id)).length})` },
          { id: 'results', label: `Results (${analyzed})` }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              tab === t.id ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Queue Tab ── */}
      {tab === 'queue' && (
        loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3 h-48">
                <div className="h-3 bg-gray-800 rounded animate-pulse w-3/4" />
                <div className="h-3 bg-gray-800 rounded animate-pulse w-full" />
                <div className="h-3 bg-gray-800 rounded animate-pulse w-1/2" />
              </div>
            ))}
          </div>
        ) : queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 bg-gray-900 rounded-xl border border-gray-800">
            <ShieldCheck size={48} className="text-green-500/30 mb-4" />
            <p className="text-gray-400 font-medium">Queue is clear</p>
            <p className="text-gray-600 text-sm mt-1">No high-severity alerts waiting for triage</p>
          </div>
        ) : (
          <>
            <p className="text-gray-500 text-sm">
              Showing {queue.length} alert{queue.length !== 1 ? 's' : ''} with severity ≥ 7.
              {' '}{queue.filter(a => !resultMap.has(a._id)).length} awaiting AI analysis.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {queue.map(alert => (
                <QueueCard
                  key={alert._id || alert.timestamp}
                  alert={alert}
                  result={resultMap.get(alert._id) || null}
                  analyzing={analyzing.has(alert._id)}
                  onAnalyze={analyzeAlert}
                  onReview={reviewResult}
                />
              ))}
            </div>
          </>
        )
      )}

      {/* ── Results Tab ── */}
      {tab === 'results' && (
        <div className="space-y-4">
          {/* Filter strip */}
          <div className="flex flex-wrap gap-2">
            {FILTER_OPTS.map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                  filter === f
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                {f === 'all' ? 'All' : f.replace('_', ' ')}
              </button>
            ))}
          </div>

          {filteredResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 bg-gray-900 rounded-xl border border-gray-800">
              <Brain size={40} className="text-purple-500/20 mb-3" />
              <p className="text-gray-500 text-sm">No results yet — analyze some alerts from the Queue tab</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredResults.map(r => (
                <ResultCard key={r.id} result={r} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

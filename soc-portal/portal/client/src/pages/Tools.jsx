import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../App';
import {
  Shield, BarChart2, Activity, Brain, Fish, Zap,
  Globe, Search, ExternalLink, RefreshCw, Terminal, Copy, Check,
  AlertCircle, CheckCircle2, XCircle, Minus, Key, Info
} from 'lucide-react';

// ── Per-tool icon / colour config ─────────────────────────────
const TOOL_META = {
  'wazuh-dashboard': { icon: Shield,   accent: '#3b82f6' },  // blue
  grafana:           { icon: BarChart2, accent: '#f97316' }, // orange
  prometheus:        { icon: Activity,  accent: '#ef4444' }, // red
  opencti:           { icon: Globe,     accent: '#e11d48' }, // rose
  velociraptor:      { icon: Search,    accent: '#22c55e' }, // green
  ollama:            { icon: Brain,     accent: '#a855f7' }, // purple
  zeek:              { icon: Fish,      accent: '#06b6d4' }, // cyan
  suricata:          { icon: Zap,       accent: '#eab308' }, // yellow
};

const CATEGORY_ORDER = ['SIEM', 'Metrics', 'Threat Intel', 'DFIR', 'AI', 'Network'];

// ── Status pill ───────────────────────────────────────────────
function StatusPill({ status }) {
  const map = {
    up:       { icon: CheckCircle2, label: 'Online',   cls: 'text-green-400 bg-green-500/10 border-green-500/20' },
    degraded: { icon: AlertCircle,  label: 'Degraded', cls: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
    down:     { icon: XCircle,      label: 'Offline',  cls: 'text-red-400 bg-red-500/10 border-red-500/20' },
    'no-ui':  { icon: Minus,        label: 'No UI',    cls: 'text-gray-500 bg-gray-800 border-gray-700' },
  };
  const { icon: Icon, label, cls } = map[status] || map['no-ui'];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cls}`}>
      <Icon size={11} />
      {label}
    </span>
  );
}

// ── Copy-to-clipboard button ──────────────────────────────────
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button onClick={copy} className="flex-shrink-0 p-1 rounded text-gray-600 hover:text-gray-300 transition-colors" title="Copy">
      {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );
}

// ── Tool card ─────────────────────────────────────────────────
function ToolCard({ tool, onOpenEmbed }) {
  const meta   = TOOL_META[tool.id] || { icon: Shield, accent: '#6b7280' };
  const Icon   = meta.icon;
  const directUrl = tool.directPort
    ? `https://${window.location.hostname}:${tool.directPort}`
    : null;
  const launchUrl = tool.externalPath || directUrl;
  const canLaunch = tool.hasUI && launchUrl;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden hover:border-gray-700 transition-colors flex flex-col">
      {/* Colour strip */}
      <div className="h-1 w-full" style={{ backgroundColor: meta.accent }} />

      <div className="p-5 flex flex-col flex-1 gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                 style={{ backgroundColor: `${meta.accent}1a`, border: `1px solid ${meta.accent}33` }}>
              <Icon size={20} style={{ color: meta.accent }} />
            </div>
            <div>
              <p className="text-white font-semibold text-sm leading-snug">{tool.name}</p>
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500">{tool.category}</span>
            </div>
          </div>
          <StatusPill status={tool.status} />
        </div>

        {/* Description */}
        <p className="text-gray-400 text-xs leading-relaxed flex-1">{tool.description}</p>

        {/* Note */}
        {tool.note && (
          <div className="flex items-start gap-2 text-xs text-gray-600 bg-gray-800 rounded-lg px-3 py-2">
            <Info size={12} className="mt-0.5 flex-shrink-0 text-gray-500" />
            <span className="leading-relaxed">{tool.note}</span>
          </div>
        )}

        {/* Credentials */}
        {tool.credentials && (
          <div className="space-y-1.5">
            <p className="text-gray-600 text-xs font-medium flex items-center gap-1.5">
              <Key size={10} /> Credentials
            </p>
            {[['Username', tool.credentials.user], ['Password', tool.credentials.pass]].map(([label, val]) => (
              <div key={label} className="flex items-center justify-between gap-2 px-3 py-1.5 bg-gray-800 rounded-lg">
                <span className="text-gray-600 text-xs w-16 flex-shrink-0">{label}</span>
                <span className="text-gray-300 text-xs font-mono flex-1 truncate">{val}</span>
                <CopyBtn text={val} />
              </div>
            ))}
          </div>
        )}

        {/* Start command (for offline tools) */}
        {tool.startCmd && tool.status === 'down' && !tool.startCmd.startsWith('(') && (
          <div className="space-y-1">
            <p className="text-gray-600 text-xs font-medium flex items-center gap-1.5">
              <Terminal size={10} /> Start command
            </p>
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-950 border border-gray-800 rounded-lg">
              <code className="text-green-400 text-xs font-mono flex-1 truncate">{tool.startCmd}</code>
              <CopyBtn text={tool.startCmd} />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-auto pt-1">
          {canLaunch ? (
            <>
              <a
                href={launchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                  tool.status === 'down'
                    ? 'bg-gray-800 text-gray-600 cursor-not-allowed pointer-events-none'
                    : 'text-white hover:opacity-90'
                }`}
                style={tool.status !== 'down' ? { backgroundColor: meta.accent } : {}}
              >
                <ExternalLink size={13} /> Open in new tab
              </a>
              {tool.status !== 'down' && tool.externalPath && (
                <button
                  onClick={() => onOpenEmbed(tool)}
                  className="px-3 py-2.5 rounded-xl text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                  title="Open embedded below"
                >
                  Embed
                </button>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center py-2.5 rounded-xl bg-gray-800 text-gray-600 text-xs">
              {tool.hasUI ? 'Service offline' : 'No browser interface'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Embedded frame panel ──────────────────────────────────────
function EmbedPanel({ tool, onClose }) {
  const meta = TOOL_META[tool.id] || { accent: '#6b7280' };

  return (
    <div className="mt-5 rounded-2xl overflow-hidden border border-gray-700" style={{ height: '75vh' }}>
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-900 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.accent }} />
          <span className="text-white text-sm font-medium">{tool.name}</span>
          <span className="text-gray-600 text-xs">{tool.externalPath}</span>
        </div>
        <div className="flex items-center gap-2">
          <a href={tool.externalPath} target="_blank" rel="noopener noreferrer"
             className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white bg-gray-800 rounded">
            <ExternalLink size={11} /> Pop out
          </a>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xs px-2 py-1 bg-gray-800 rounded">
            ✕ Close
          </button>
        </div>
      </div>

      {/* iFrame */}
      <iframe
        src={tool.externalPath}
        title={tool.name}
        className="w-full bg-gray-950"
        style={{ height: 'calc(75vh - 42px)', border: 'none' }}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation"
      />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function Tools() {
  const { apiFetch } = useAuth();
  const [tools,     setTools]    = useState([]);
  const [loading,   setLoading]  = useState(true);
  const [embedTool, setEmbedTool] = useState(null);
  const [filter,    setFilter]   = useState('All');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch('/api/tools');
      const data = await r?.json();
      if (Array.isArray(data)) setTools(data);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { load(); }, [load]);

  // Stats
  const online  = tools.filter(t => t.status === 'up').length;
  const total   = tools.length;

  // Category filter
  const categories = ['All', ...CATEGORY_ORDER.filter(c => tools.some(t => t.category === c))];
  const visible = filter === 'All' ? tools : tools.filter(t => t.category === filter);

  // Group by category for display
  const grouped = CATEGORY_ORDER.reduce((acc, cat) => {
    const items = visible.filter(t => t.category === cat);
    if (items.length) acc.push({ cat, items });
    return acc;
  }, []);

  function openEmbed(tool) {
    setEmbedTool(prev => prev?.id === tool.id ? null : tool);
    setTimeout(() => document.getElementById('embed-panel')?.scrollIntoView({ behavior: 'smooth' }), 100);
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Tools & Integrations</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Launch and monitor all security tools in the stack
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Stats chip */}
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border border-gray-800 rounded-xl">
            <div className={`w-2 h-2 rounded-full ${online === total ? 'bg-green-500' : online > 0 ? 'bg-yellow-500' : 'bg-red-500'}`} />
            <span className="text-gray-300 text-sm font-medium">{online}</span>
            <span className="text-gray-600 text-sm">/ {total} online</span>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-xl text-sm transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2">
        {categories.map(c => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === c
                ? 'bg-blue-600 text-white'
                : 'bg-gray-900 border border-gray-800 text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Cards — grouped by category */}
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3 h-56">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gray-800 animate-pulse" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-3 bg-gray-800 rounded animate-pulse w-2/3" />
                  <div className="h-2.5 bg-gray-800 rounded animate-pulse w-1/3" />
                </div>
              </div>
              <div className="h-2.5 bg-gray-800 rounded animate-pulse w-full" />
              <div className="h-2.5 bg-gray-800 rounded animate-pulse w-4/5" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ cat, items }) => (
            <div key={cat}>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-widest mb-3 pl-1">
                {cat}
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {items.map(tool => (
                  <ToolCard
                    key={tool.id}
                    tool={tool}
                    onOpenEmbed={openEmbed}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Embedded frame */}
      {embedTool && (
        <div id="embed-panel">
          <EmbedPanel tool={embedTool} onClose={() => setEmbedTool(null)} />
        </div>
      )}
    </div>
  );
}

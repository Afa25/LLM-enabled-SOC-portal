import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../App';
import {
  FileText, Plus, Trash2, Eye, Loader, Brain,
  Calendar, ChevronDown, X, Download, RefreshCw, Sparkles
} from 'lucide-react';

/* ── tiny markdown renderer ─────────────────────────────────────────── */
function Markdown({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^### /.test(line))      { elements.push(<h3 key={key++} className="text-lg font-bold text-white mt-5 mb-2">{line.slice(4)}</h3>); continue; }
    if (/^## /.test(line))       { elements.push(<h2 key={key++} className="text-xl font-bold text-blue-400 mt-6 mb-2 border-b border-gray-700 pb-1">{line.slice(3)}</h2>); continue; }
    if (/^# /.test(line))        { elements.push(<h1 key={key++} className="text-2xl font-bold text-white mt-6 mb-3">{line.slice(2)}</h1>); continue; }
    if (/^\|/.test(line))        { elements.push(<p  key={key++} className="font-mono text-xs text-gray-400 whitespace-pre">{line}</p>); continue; }
    if (/^[-*] /.test(line))     { elements.push(<li key={key++} className="text-gray-300 text-sm ml-4 list-disc">{inlineFormat(line.slice(2))}</li>); continue; }
    if (/^\d+\. /.test(line))    { elements.push(<li key={key++} className="text-gray-300 text-sm ml-4 list-decimal">{inlineFormat(line.replace(/^\d+\. /,''))}</li>); continue; }
    if (line.trim() === '')      { elements.push(<div key={key++} className="h-2" />); continue; }
    if (/^═{3,}/.test(line))    { elements.push(<hr key={key++} className="border-gray-700 my-3" />); continue; }
    elements.push(<p key={key++} className="text-gray-300 text-sm leading-relaxed">{inlineFormat(line)}</p>);
  }
  return <div className="space-y-0.5">{elements}</div>;
}

function inlineFormat(text) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((p, i) => {
    if (/^\*\*.*\*\*$/.test(p)) return <strong key={i} className="text-white font-semibold">{p.slice(2,-2)}</strong>;
    if (/^`.*`$/.test(p))       return <code key={i} className="font-mono text-xs bg-gray-800 text-green-400 px-1 rounded">{p.slice(1,-1)}</code>;
    return p;
  });
}

/* ── badge ──────────────────────────────────────────────────────────── */
function Badge({ text, color = 'blue' }) {
  const map = { blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20', purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20', green: 'bg-green-500/10 text-green-400 border-green-500/20', orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20' };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium border ${map[color] || map.blue}`}>{text}</span>;
}

const TF_COLOR = { daily: 'blue', weekly: 'purple', monthly: 'green', custom: 'orange' };

/* ── Report card ──────────────────────────────────────────────────────*/
function ReportCard({ report, onView, onDelete }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 flex flex-col gap-3 hover:border-gray-700 transition-colors">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-blue-500/10 rounded-lg flex-shrink-0">
          <FileText size={18} className="text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm leading-tight line-clamp-2">{report.title}</p>
          <p className="text-gray-500 text-xs mt-1">{new Date(report.created).toLocaleString()}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge text={report.timeframe} color={TF_COLOR[report.timeframe] || 'blue'} />
        <Badge text={`${report.alert_count} alerts`} color="orange" />
        <Badge text={report.model?.split(':')[0] || 'LLM'} color="purple" />
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={() => onView(report)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg transition-colors">
          <Eye size={12} /> View
        </button>
        <button onClick={() => onDelete(report.id)}
          className="px-3 py-2 bg-gray-800 hover:bg-red-500/20 hover:text-red-400 text-gray-400 text-xs rounded-lg transition-colors">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

/* ── Generate modal ───────────────────────────────────────────────────*/
function GenerateModal({ onClose, onGenerated }) {
  const { apiFetch }  = useAuth();
  const [tf,     setTf]     = useState('daily');
  const [start,  setStart]  = useState('');
  const [end,    setEnd]    = useState('');
  const [model,  setModel]  = useState('llama3.2:3b');
  const [models, setModels] = useState(['llama3.2:3b']);
  const [busy,   setBusy]   = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    apiFetch('/api/reports/models/list').then(r => r?.json()).then(m => {
      if (Array.isArray(m) && m.length) { setModels(m); setModel(m[0]); }
    }).catch(() => {});
  }, []);

  async function submit() {
    setBusy(true);
    setStatus('Fetching alert data from Wazuh…');

    // Capture current count BEFORE triggering generation
    const beforeRes   = await apiFetch('/api/reports');
    const beforeList  = await beforeRes?.json();
    const beforeCount = Array.isArray(beforeList) ? beforeList.length : 0;

    const body = { timeframe: tf, model };
    if (tf === 'custom' && start) body.startDate = start;
    if (tf === 'custom' && end)   body.endDate   = end;
    await apiFetch('/api/reports/generate', { method: 'POST', body: JSON.stringify(body) });
    setStatus('Generating report with local AI (this may take 1–3 minutes)…');

    // Poll until a NEW report appears (count increases)
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      const res  = await apiFetch('/api/reports');
      const list = await res?.json();
      if (Array.isArray(list) && list.length > beforeCount) {
        clearInterval(poll);
        setBusy(false);
        onGenerated();
        onClose();
      }
      if (attempts > 60) { clearInterval(poll); setBusy(false); setStatus('Timed out — check server logs'); }
    }, 5000);
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-purple-400" />
            <h2 className="text-white font-semibold">Generate AI Report</h2>
          </div>
          <button onClick={onClose} disabled={busy} className="text-gray-500 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Timeframe */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Report Timeframe</label>
            <div className="grid grid-cols-4 gap-2">
              {['daily','weekly','monthly','custom'].map(t => (
                <button key={t} onClick={() => setTf(t)}
                  className={`py-2 rounded-lg text-xs font-medium capitalize transition-colors ${tf === t ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Custom dates */}
          {tf === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Start Date</label>
                <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">End Date</label>
                <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
              </div>
            </div>
          )}

          {/* Model */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">LLM Model (local / no API key)</label>
            <select value={model} onChange={e => setModel(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <p className="text-gray-600 text-xs mt-1">Runs entirely on your server — no data sent externally.</p>
          </div>

          {/* Status */}
          {busy && (
            <div className="flex items-center gap-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
              <Loader size={16} className="text-purple-400 animate-spin flex-shrink-0" />
              <p className="text-purple-300 text-sm">{status}</p>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-gray-800 flex gap-3">
          <button onClick={onClose} disabled={busy}
            className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={busy}
            className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors flex items-center justify-center gap-2">
            {busy ? <><Loader size={14} className="animate-spin" /> Generating…</> : <><Brain size={14} /> Generate</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Report viewer modal ───────────────────────────────────────────── */
function ReportViewer({ report, onClose }) {
  function download() {
    const blob = new Blob([report.content], { type: 'text/markdown' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${report.title}.md`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <FileText size={18} className="text-blue-400 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm truncate">{report.title}</p>
              <p className="text-gray-500 text-xs">{new Date(report.created).toLocaleString()} · {report.alert_count} alerts · {report.model}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={download}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors">
              <Download size={12} /> .md
            </button>
            <button onClick={onClose} className="p-1.5 text-gray-500 hover:text-white"><X size={18} /></button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <Markdown text={report.content} />
        </div>
      </div>
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────────── */
export default function Reports() {
  const { apiFetch }    = useAuth();
  const [reports,    setReports]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showGen,    setShowGen]    = useState(false);
  const [viewing,    setViewing]    = useState(null);

  async function load() {
    setLoading(true);
    const res  = await apiFetch('/api/reports');
    const data = await res?.json();
    setReports(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  async function deleteReport(id) {
    if (!confirm('Delete this report?')) return;
    await apiFetch(`/api/reports/${id}`, { method: 'DELETE' });
    load();
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5">
      {/* Modals */}
      {showGen  && <GenerateModal onClose={() => setShowGen(false)} onGenerated={load} />}
      {viewing  && <ReportViewer report={viewing} onClose={() => setViewing(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Reports</h1>
          <p className="text-gray-500 text-sm mt-0.5">SOC security reports generated by your local LLM — no API key required</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => setShowGen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium transition-colors">
            <Brain size={16} /> Generate Report
          </button>
        </div>
      </div>

      {/* LLM info banner */}
      <div className="flex items-start gap-3 p-4 bg-purple-500/10 border border-purple-500/20 rounded-xl">
        <Sparkles size={18} className="text-purple-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-purple-300 text-sm font-medium">Powered by Ollama — 100% Local AI</p>
          <p className="text-gray-400 text-xs mt-1">Reports are generated by a local LLM (llama3.2, mistral, phi3 etc.) running inside Docker. No data is sent to any external API. The AI reads real alert statistics from your Wazuh SIEM and writes professional security reports.</p>
        </div>
      </div>

      {/* Reports grid */}
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
              <div className="h-4 bg-gray-800 rounded animate-pulse w-3/4" />
              <div className="h-3 bg-gray-800 rounded animate-pulse w-full" />
              <div className="flex gap-2"><div className="h-5 w-16 bg-gray-800 rounded animate-pulse" /><div className="h-5 w-16 bg-gray-800 rounded animate-pulse" /></div>
            </div>
          ))}
        </div>
      ) : reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-gray-900 rounded-xl border border-gray-800">
          <Brain size={48} className="text-purple-500/30 mb-4" />
          <p className="text-gray-400 font-medium">No reports yet</p>
          <p className="text-gray-600 text-sm mt-1 mb-4">Generate your first AI-powered SOC report</p>
          <button onClick={() => setShowGen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm transition-colors">
            <Brain size={14} /> Generate First Report
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map(r => (
            <ReportCard key={r.id} report={r} onView={setViewing} onDelete={deleteReport} />
          ))}
        </div>
      )}
    </div>
  );
}

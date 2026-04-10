import React, { useState, useEffect } from 'react';
import { useAuth } from '../App';
import { Clock, Plus, Trash2, Play, ToggleLeft, ToggleRight, X, Loader, CheckCircle } from 'lucide-react';

const TF_CRON = { daily: '0 6 * * *', weekly: '0 7 * * 1', monthly: '0 8 1 * *', custom: '' };
const TF_DESC = {
  daily:   'Every day at 06:00',
  weekly:  'Every Monday at 07:00',
  monthly: '1st of every month at 08:00',
  custom:  'Custom cron expression',
};
const TF_COLOR = { daily: 'blue', weekly: 'purple', monthly: 'green', custom: 'orange' };

function ScheduleCard({ schedule, onToggle, onDelete, onRunNow }) {
  const [running, setRunning] = useState(false);

  async function handleRunNow() {
    setRunning(true);
    await onRunNow(schedule.id);
    setTimeout(() => setRunning(false), 3000);
  }

  const colorMap = {
    blue:   'border-blue-500/20 bg-blue-500/5',
    purple: 'border-purple-500/20 bg-purple-500/5',
    green:  'border-green-500/20 bg-green-500/5',
    orange: 'border-orange-500/20 bg-orange-500/5',
  };
  const textMap = { blue: 'text-blue-400', purple: 'text-purple-400', green: 'text-green-400', orange: 'text-orange-400' };
  const color = TF_COLOR[schedule.timeframe] || 'blue';

  return (
    <div className={`rounded-xl border p-5 flex flex-col gap-3 transition-all ${schedule.enabled ? colorMap[color] : 'border-gray-800 bg-gray-900 opacity-60'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-white font-semibold">{schedule.name}</p>
          <p className="text-gray-500 text-xs mt-0.5">{TF_DESC[schedule.timeframe] || schedule.cron_expr}</p>
        </div>
        <button onClick={() => onToggle(schedule)}
          className={`flex-shrink-0 transition-colors ${schedule.enabled ? textMap[color] : 'text-gray-600 hover:text-gray-400'}`}
          title={schedule.enabled ? 'Disable schedule' : 'Enable schedule'}>
          {schedule.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
        </button>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-y-2 text-xs">
        <div>
          <p className="text-gray-600">Timeframe</p>
          <p className={`font-medium capitalize ${schedule.enabled ? textMap[color] : 'text-gray-500'}`}>{schedule.timeframe}</p>
        </div>
        <div>
          <p className="text-gray-600">Model</p>
          <p className="text-gray-400 font-mono">{schedule.model}</p>
        </div>
        <div>
          <p className="text-gray-600">Cron</p>
          <p className="text-gray-400 font-mono">{schedule.cron_expr}</p>
        </div>
        <div>
          <p className="text-gray-600">Last Run</p>
          <p className="text-gray-400">{schedule.last_run ? new Date(schedule.last_run).toLocaleDateString() : 'Never'}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button onClick={handleRunNow} disabled={running}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition-colors disabled:opacity-50">
          {running
            ? <><Loader size={12} className="animate-spin" /> Running…</>
            : <><Play size={12} /> Run Now</>
          }
        </button>
        <button onClick={() => onDelete(schedule.id)}
          className="px-3 py-2 bg-gray-800 hover:bg-red-500/20 hover:text-red-400 text-gray-500 text-xs rounded-lg transition-colors">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function CreateModal({ onClose, onCreate }) {
  const { apiFetch } = useAuth();
  const [name,   setName]   = useState('');
  const [tf,     setTf]     = useState('daily');
  const [cron,   setCron]   = useState('');
  const [model,  setModel]  = useState('llama3.2:3b');
  const [models, setModels] = useState(['llama3.2:3b']);
  const [busy,   setBusy]   = useState(false);
  const [ok,     setOk]     = useState(false);

  useEffect(() => {
    apiFetch('/api/reports/models/list').then(r => r?.json()).then(m => {
      if (Array.isArray(m) && m.length) { setModels(m); setModel(m[0]); }
    }).catch(() => {});
  }, []);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    const body = { name, timeframe: tf, model };
    if (tf === 'custom' && cron) body.cron_expr = cron;
    await apiFetch('/api/schedule', { method: 'POST', body: JSON.stringify(body) });
    setOk(true);
    setTimeout(() => { setOk(false); setBusy(false); onCreate(); onClose(); }, 1200);
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-blue-400" />
            <h2 className="text-white font-semibold">New Report Schedule</h2>
          </div>
          <button onClick={onClose}><X size={18} className="text-gray-500 hover:text-white" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Schedule Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Daily Security Report"
              className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500" />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Frequency</label>
            <div className="grid grid-cols-4 gap-2">
              {['daily','weekly','monthly','custom'].map(t => (
                <button key={t} onClick={() => setTf(t)}
                  className={`py-2 rounded-lg text-xs font-medium capitalize transition-colors ${tf === t ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                  {t}
                </button>
              ))}
            </div>
            <p className="text-gray-600 text-xs mt-1.5">{TF_DESC[tf]}</p>
          </div>

          {tf === 'custom' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Cron Expression</label>
              <input value={cron} onChange={e => setCron(e.target.value)} placeholder="0 9 * * 1-5"
                className="w-full bg-gray-800 border border-gray-700 text-gray-200 text-sm font-mono rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500" />
              <p className="text-gray-600 text-xs mt-1">Standard cron format: min hour day month weekday</p>
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-1.5">LLM Model</label>
            <select value={model} onChange={e => setModel(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500">
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="p-5 border-t border-gray-800 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg">Cancel</button>
          <button onClick={submit} disabled={busy || !name.trim()}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg flex items-center justify-center gap-2">
            {ok ? <><CheckCircle size={14} /> Created!</> : busy ? <><Loader size={14} className="animate-spin" /> Creating…</> : <><Plus size={14} /> Create</>}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Scheduler() {
  const { apiFetch }  = useAuth();
  const [schedules, setSchedules] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);

  async function load() {
    setLoading(true);
    const res  = await apiFetch('/api/schedule');
    const data = await res?.json();
    setSchedules(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  async function toggleSchedule(s) {
    await apiFetch(`/api/schedule/${s.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !s.enabled }) });
    load();
  }

  async function deleteSchedule(id) {
    if (!confirm('Delete this schedule?')) return;
    await apiFetch(`/api/schedule/${id}`, { method: 'DELETE' });
    load();
  }

  async function runNow(id) {
    await apiFetch(`/api/schedule/${id}/run`, { method: 'POST' });
  }

  useEffect(() => { load(); }, []);

  const active   = schedules.filter(s => s.enabled).length;
  const inactive = schedules.length - active;

  return (
    <div className="space-y-5">
      {showModal && <CreateModal onClose={() => setShowModal(false)} onCreate={load} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Report Scheduler</h1>
          <p className="text-gray-500 text-sm mt-0.5">Automate AI security report generation on a schedule</p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
          <Plus size={16} /> New Schedule
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Schedules', val: schedules.length, cls: 'text-white border-gray-700'          },
          { label: 'Active',          val: active,           cls: 'text-green-400 border-green-500/30'  },
          { label: 'Paused',          val: inactive,         cls: 'text-gray-500 border-gray-700'       },
        ].map(({ label, val, cls }) => (
          <div key={label} className={`bg-gray-900 rounded-xl border p-4 text-center ${cls}`}>
            <p className="text-2xl font-bold">{loading ? '—' : val}</p>
            <p className="text-gray-500 text-sm mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Info box */}
      <div className="flex gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-sm">
        <Clock size={18} className="text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="text-gray-400">
          <p className="text-blue-300 font-medium mb-0.5">How scheduling works</p>
          Schedules use server-side cron jobs. When triggered, the portal fetches live alert data from Wazuh, sends it to the local Ollama LLM, and saves the generated report automatically. You can also trigger any schedule manually with <strong className="text-white">Run Now</strong>.
        </div>
      </div>

      {/* Schedule cards */}
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
              <div className="h-5 bg-gray-800 rounded animate-pulse w-1/2" />
              <div className="h-3 bg-gray-800 rounded animate-pulse w-3/4" />
              <div className="h-8 bg-gray-800 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-gray-900 rounded-xl border border-gray-800">
          <Clock size={44} className="text-blue-500/20 mb-3" />
          <p className="text-gray-400 font-medium">No schedules configured</p>
          <p className="text-gray-600 text-sm mt-1 mb-4">Set up automated daily, weekly or monthly reports</p>
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm">
            <Plus size={14} /> Create First Schedule
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {schedules.map(s => (
            <ScheduleCard key={s.id} schedule={s}
              onToggle={toggleSchedule} onDelete={deleteSchedule} onRunNow={runNow} />
          ))}
        </div>
      )}
    </div>
  );
}

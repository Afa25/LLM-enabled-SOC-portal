import React, { useState, useEffect } from 'react';
import { useAuth } from '../App';
import { Monitor, CheckCircle, XCircle, Clock, Search, RefreshCw, Cpu, Globe, Hash } from 'lucide-react';

function AgentCard({ agent }) {
  const isActive  = agent.status === 'active';
  const osName    = agent?.os?.name  || agent?.os?.platform || '—';
  const osVersion = agent?.os?.version || '';
  const lastSeen  = agent.lastKeepAlive
    ? new Date(agent.lastKeepAlive).toLocaleString()
    : '—';

  return (
    <div className={`bg-gray-900 rounded-xl border p-5 flex flex-col gap-3 transition-colors ${isActive ? 'border-green-500/20' : 'border-gray-800'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Monitor size={18} className={isActive ? 'text-green-400' : 'text-gray-600'} />
          <p className="text-white font-semibold truncate">{agent.name}</p>
        </div>
        <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
          isActive ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-gray-800 text-gray-500 border border-gray-700'
        }`}>
          {isActive ? <CheckCircle size={10} /> : <XCircle size={10} />}
          {isActive ? 'Active' : agent.status || 'Offline'}
        </span>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-gray-500">
          <Hash size={11} />
          <span className="font-mono text-gray-400">{agent.id}</span>
        </div>
        <div className="flex items-center gap-1.5 text-gray-500">
          <Globe size={11} />
          <span className="font-mono text-gray-400">{agent.ip || '—'}</span>
        </div>
        <div className="flex items-center gap-1.5 text-gray-500 col-span-2">
          <Cpu size={11} />
          <span className="text-gray-400 truncate">{osName} {osVersion}</span>
        </div>
        <div className="flex items-center gap-1.5 text-gray-500 col-span-2">
          <Clock size={11} />
          <span className="text-gray-400">Last seen: {lastSeen}</span>
        </div>
      </div>

      {/* Version badge */}
      {agent.version && (
        <div className="pt-2 border-t border-gray-800">
          <span className="text-xs font-mono text-blue-400/70">v{agent.version}</span>
        </div>
      )}
    </div>
  );
}

export default function Agents() {
  const { apiFetch }  = useAuth();
  const [agents,   setAgents]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');

  async function load() {
    setLoading(true);
    const res  = await apiFetch('/api/agents');
    const data = await res?.json();
    setAgents(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = agents.filter(a =>
    !search ||
    a.name?.toLowerCase().includes(search.toLowerCase()) ||
    a.ip?.includes(search) ||
    a.id?.includes(search)
  );

  const active   = agents.filter(a => a.status === 'active').length;
  const inactive = agents.length - active;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Agents</h1>
          <p className="text-gray-500 text-sm mt-0.5">Monitored endpoints connected to Wazuh Manager</p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Agents',  val: agents.length, color: 'border-gray-700 text-white'           },
          { label: 'Active',        val: active,         color: 'border-green-500/30 text-green-400'   },
          { label: 'Disconnected',  val: inactive,       color: 'border-red-500/30 text-red-400'       },
        ].map(({ label, val, color }) => (
          <div key={label} className={`bg-gray-900 rounded-xl border p-4 text-center ${color}`}>
            <p className="text-2xl font-bold">{loading ? '—' : val}</p>
            <p className="text-gray-500 text-sm mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, IP, or ID…"
          className="w-full bg-gray-900 border border-gray-800 text-gray-300 text-sm rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:border-blue-500 transition-colors"
        />
      </div>

      {/* Agent grid */}
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
              <div className="h-5 bg-gray-800 rounded animate-pulse w-1/2" />
              <div className="h-3 bg-gray-800 rounded animate-pulse w-full" />
              <div className="h-3 bg-gray-800 rounded animate-pulse w-3/4" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-600">
          <Monitor size={44} className="mb-3 opacity-30" />
          <p className="font-medium text-gray-500">{search ? 'No agents match your search' : 'No agents found'}</p>
          <p className="text-sm mt-1">
            {search ? 'Try a different search term' : 'Deploy Wazuh agents on your endpoints'}
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(a => <AgentCard key={a.id} agent={a} />)}
        </div>
      )}
    </div>
  );
}

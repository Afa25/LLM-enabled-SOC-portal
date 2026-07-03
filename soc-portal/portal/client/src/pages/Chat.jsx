import React, {
  useState, useEffect, useRef, useCallback
} from 'react';
import { useAuth } from '../App';
import {
  MessageSquare, Send, Trash2, Bot, User,
  Loader, Zap, Shield, AlertTriangle, BookOpen,
  Search, ToggleLeft, ToggleRight, Settings
} from 'lucide-react';

// ── Tiny inline markdown renderer ────────────────────────────────────────────
function Markdown({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  const els   = [];
  let key = 0;

  const inline = t => {
    const parts = t.split(/(\*\*.*?\*\*|`[^`]+`|\*[^*]+\*)/g);
    return parts.map((p, i) => {
      if (/^\*\*.*\*\*$/.test(p)) return <strong key={i} className="text-white font-semibold">{p.slice(2,-2)}</strong>;
      if (/^`[^`]+`$/.test(p))   return <code   key={i} className="font-mono text-xs bg-gray-800 text-green-400 px-1 py-0.5 rounded">{p.slice(1,-1)}</code>;
      if (/^\*[^*]+\*$/.test(p)) return <em     key={i} className="italic text-gray-300">{p.slice(1,-1)}</em>;
      return p;
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^### /.test(l))   { els.push(<h3 key={key++} className="text-base font-bold text-white mt-4 mb-1">{l.slice(4)}</h3>); continue; }
    if (/^## /.test(l))    { els.push(<h2 key={key++} className="text-lg font-bold text-blue-400 mt-5 mb-1 border-b border-gray-700 pb-1">{l.slice(3)}</h2>); continue; }
    if (/^# /.test(l))     { els.push(<h1 key={key++} className="text-xl font-bold text-white mt-5 mb-2">{l.slice(2)}</h1>); continue; }
    if (/^[-*] /.test(l))  { els.push(<li key={key++} className="text-gray-300 text-sm ml-4 list-disc my-0.5">{inline(l.slice(2))}</li>); continue; }
    if (/^\d+\. /.test(l)) { els.push(<li key={key++} className="text-gray-300 text-sm ml-4 list-decimal my-0.5">{inline(l.replace(/^\d+\. /,''))}</li>); continue; }
    if (/^```/.test(l)) {
      const block = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) block.push(lines[i++]);
      els.push(<pre key={key++} className="bg-gray-950 border border-gray-800 rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono text-green-400 whitespace-pre">{block.join('\n')}</pre>);
      continue;
    }
    if (l.trim() === '')   { els.push(<div key={key++} className="h-1.5" />); continue; }
    if (/^---+$/.test(l))  { els.push(<hr  key={key++} className="border-gray-700 my-3" />); continue; }
    els.push(<p key={key++} className="text-gray-300 text-sm leading-relaxed">{inline(l)}</p>);
  }

  return <div className="space-y-0.5">{els}</div>;
}

// ── Suggested prompts ─────────────────────────────────────────────────────────
const SUGGESTIONS = [
  { icon: AlertTriangle, label: 'Current threat level',   prompt: 'Based on the current SOC context, what is our threat level right now and what should I focus on?' },
  { icon: Search,        label: 'Analyse alerts',         prompt: 'Summarise the current alert distribution — what do the top categories tell us about what is happening?' },
  { icon: Shield,        label: 'Brute force check',      prompt: 'Are there any signs of brute force or credential stuffing in the current alert data?' },
  { icon: Zap,           label: 'MITRE ATT&CK mapping',   prompt: 'Map the currently observed alerts to MITRE ATT&CK tactics and explain what each technique means.' },
  { icon: BookOpen,      label: 'SOC playbook',           prompt: 'Give me a step-by-step investigation playbook for the most critical active alert category.' },
  { icon: Search,        label: 'Lateral movement',       prompt: 'Explain lateral movement (T1021) and what Wazuh rules to watch for in our environment.' },
];

// ── Message bubble ────────────────────────────────────────────────────────────
function Message({ msg }) {
  const isUser = msg.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
        isUser ? 'bg-blue-600' : 'bg-purple-600/40 border border-purple-500/30'
      }`}>
        {isUser ? <User size={14} className="text-white" /> : <Bot size={14} className="text-purple-300" />}
      </div>

      <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
        isUser
          ? 'bg-blue-600 text-white rounded-tr-sm'
          : 'bg-gray-800 border border-gray-700 rounded-tl-sm'
      }`}>
        {isUser ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <>
            <Markdown text={msg.content} />
            {msg.streaming && (
              <span className="inline-block w-1.5 h-4 bg-purple-400 ml-0.5 animate-pulse rounded-sm align-middle" />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Main chat page ────────────────────────────────────────────────────────────
export default function Chat() {
  const { token } = useAuth();

  const [messages,     setMessages]     = useState([]);
  const [input,        setInput]        = useState('');
  const [streaming,    setStreaming]     = useState(false);
  const [useContext,   setUseContext]    = useState(true);
  const [model,        setModel]         = useState('llama3.2:3b');
  const [models,       setModels]        = useState(['llama3.2:3b']);
  const [showSettings, setShowSettings] = useState(false);
  const [error,        setError]         = useState(null);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const abortRef  = useRef(null);

  useEffect(() => {
    fetch('/api/chat/models', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(m => { if (Array.isArray(m) && m.length) { setModels(m); setModel(m[0]); } })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text) => {
    const content = text.trim();
    if (!content || streaming) return;

    setError(null);
    setInput('');

    const userMsg     = { role: 'user', content };
    const chatHistory = [...messages.filter(m => ['user','assistant'].includes(m.role)), userMsg];
    const placeholder = { role: 'assistant', content: '', streaming: true };

    setMessages([...messages, userMsg, placeholder]);
    setStreaming(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat/stream', {
        method : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body   : JSON.stringify({ messages: chatHistory, useContext, model }),
        signal : controller.signal,
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let assistantText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));

            if (data.token) {
              assistantText += data.token;
              setMessages(prev => {
                const updated = [...prev];
                const last    = updated.length - 1;
                updated[last] = { role: 'assistant', content: assistantText, streaming: true };
                return updated;
              });
            }

            if (data.done) {
              setMessages(prev => {
                const updated = [...prev];
                const last    = updated.length - 1;
                updated[last] = { role: 'assistant', content: assistantText, streaming: false };
                return updated;
              });
            }

            if (data.error) {
              setError(data.error);
              setMessages(prev => {
                if (prev.length && prev[prev.length-1].role === 'assistant' && !prev[prev.length-1].content)
                  return prev.slice(0, -1);
                return prev;
              });
            }
          } catch { /* partial SSE line */ }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
        setMessages(prev => {
          if (prev.length && prev[prev.length-1].role === 'assistant' && !prev[prev.length-1].content)
            return prev.slice(0, -1);
          return prev;
        });
      }
    } finally {
      setStreaming(false);
      setMessages(prev => {
        if (prev.length && prev[prev.length - 1]?.streaming) {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false };
          return updated;
        }
        return prev;
      });
      inputRef.current?.focus();
    }
  }, [messages, streaming, useContext, model, token]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
  }

  function clearChat() {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStreaming(false);
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col h-[calc(100vh-theme(spacing.6)*2-theme(spacing.6))] min-h-[500px]">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <MessageSquare size={22} className="text-purple-400" />
            SOC Assistant
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Powered by local Ollama + RAG — retrieves from Wazuh, Suricata, Zeek, CrowdSec, Docker, Prometheus &amp; OpenCTI
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setUseContext(v => !v)}
            title={useContext ? 'Live SOC context: ON' : 'Live SOC context: OFF'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              useContext
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-gray-800 border-gray-700 text-gray-500'
            }`}
          >
            {useContext ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
            Live context
          </button>

          <button
            onClick={() => setShowSettings(v => !v)}
            className={`p-2 rounded-lg border transition-colors ${
              showSettings ? 'bg-gray-700 border-gray-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
            }`}
          >
            <Settings size={14} />
          </button>

          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 hover:text-white rounded-lg text-xs transition-colors"
            >
              <Trash2 size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Settings panel ── */}
      {showSettings && (
        <div className="mb-3 p-3 bg-gray-900 border border-gray-700 rounded-xl flex-shrink-0">
          <div className="flex items-center gap-3">
            <label className="text-gray-400 text-xs whitespace-nowrap">LLM Model</label>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="flex-1 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-purple-500"
            >
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <p className="text-gray-600 text-xs whitespace-nowrap">
              {useContext ? 'Live alert data injected' : 'No SOC context'}
            </p>
          </div>
        </div>
      )}

      {/* ── Live context indicator ── */}
      {useContext && messages.length === 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg mb-3 flex-shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <p className="text-green-400 text-xs">
            RAG active — relevant events from Wazuh, Suricata, Zeek, CrowdSec, Docker, Prometheus and OpenCTI are retrieved for each message
          </p>
        </div>
      )}

      {/* ── Message area ── */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 pb-2">

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6 py-8">
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center mx-auto mb-3">
                <Bot size={28} className="text-purple-400" />
              </div>
              <p className="text-white font-semibold">SOC Assistant</p>
              <p className="text-gray-500 text-sm mt-1">
                Ask about current alerts, MITRE techniques, investigation steps, or threat analysis
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 w-full max-w-2xl">
              {SUGGESTIONS.map(({ icon: Icon, label, prompt }) => (
                <button
                  key={label}
                  onClick={() => sendMessage(prompt)}
                  className="flex items-center gap-2 p-3 bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-gray-600 rounded-xl text-left transition-colors group"
                >
                  <Icon size={14} className="text-purple-400 flex-shrink-0" />
                  <span className="text-gray-400 group-hover:text-gray-200 text-xs leading-snug">{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <Message key={i} msg={msg} />
        ))}

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
            <AlertTriangle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-red-400 text-xs font-medium">Error</p>
              <p className="text-red-300/70 text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input area ── */}
      <div className="flex-shrink-0 mt-3">
        <div className={`flex items-end gap-2 p-3 bg-gray-900 border rounded-2xl transition-colors ${
          streaming ? 'border-purple-500/40' : 'border-gray-700 focus-within:border-gray-600'
        }`}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about threats, alerts, MITRE techniques, investigation steps… (Enter to send)"
            rows={1}
            disabled={streaming}
            className="flex-1 bg-transparent text-gray-200 text-sm resize-none focus:outline-none placeholder-gray-600 max-h-40 overflow-y-auto leading-relaxed disabled:opacity-50"
            style={{ height: 'auto' }}
            onInput={e => {
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || streaming}
            className="flex-shrink-0 p-2.5 rounded-xl transition-colors disabled:opacity-40 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 text-white"
          >
            {streaming ? <Loader size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        <p className="text-gray-700 text-xs mt-1.5 text-center">
          Conversations are not stored — they clear on refresh
        </p>
      </div>
    </div>
  );
}

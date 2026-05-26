import React, { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate, useLocation } from 'react-router-dom';
import Dashboard   from './pages/Dashboard';
import Alerts      from './pages/Alerts';
import Agents      from './pages/Agents';
import Devices     from './pages/Devices';
import Reports     from './pages/Reports';
import Scheduler   from './pages/Scheduler';
import Triage      from './pages/Triage';
import Chat        from './pages/Chat';
import Tools       from './pages/Tools';
import Login       from './pages/Login';
import {
  LayoutDashboard, ShieldAlert, Monitor, Smartphone,
  FileText, Clock, LogOut, Shield, Menu, ScanSearch, MessageSquare, Boxes,
  Network, Copy, Check, X, Globe
} from 'lucide-react';

// ── Network Settings Modal ─────────────────────────────────────
function NetworkModal({ onClose }) {
  const { apiFetch } = useAuth();
  const [data,    setData]    = useState(null);
  const [copied,  setCopied]  = useState('');

  useEffect(() => {
    apiFetch('/api/settings/network').then(r => r?.json()).then(setData);
  }, []);

  function copy(text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied(''), 2000);
    });
  }

  function open(ip) {
    window.location.href = `http://${ip}`;
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-blue-400" />
            <h2 className="text-white font-semibold">Network Access</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-gray-400 text-sm">
            The portal is accessible from any of the addresses below.
            Click an IP to switch your browser to that address, or copy it to share with others.
          </p>

          {!data ? (
            <p className="text-gray-500 text-sm text-center py-4">Loading interfaces…</p>
          ) : (
            <div className="space-y-2">
              {/* Current */}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-blue-400 font-medium mb-0.5">Current</p>
                  <p className="text-white font-mono text-sm">{data.current}</p>
                </div>
                <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded">active</span>
              </div>

              {/* Available interfaces */}
              {data.interfaces.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-2">No network interfaces found</p>
              )}
              {data.interfaces.map(iface => (
                <div key={iface.address}
                  className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 flex items-center justify-between group hover:border-gray-600 transition-colors">
                  <div>
                    <p className="text-xs text-gray-500 font-medium mb-0.5">{iface.name}</p>
                    <p className="text-white font-mono text-sm">{iface.address}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copy(iface.address)}
                      title="Copy IP"
                      className="p-1.5 text-gray-500 hover:text-white rounded transition-colors">
                      {copied === iface.address ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                    <button
                      onClick={() => open(iface.address)}
                      title="Open in this address"
                      className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
                      Switch
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="text-gray-600 text-xs pt-1">
            Tip: share the IP with colleagues on the same network — they can open the portal without any extra setup.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Auth + Page-State Context ──────────────────────────────────
export const AuthCtx = createContext(null);
export function useAuth() { return useContext(AuthCtx); }

// Hook: persists page state in the global store so it survives navigation
export function usePageState(key, initial = {}) {
  const { pageStore, setPageState, registerPageInitial } = useAuth();
  const initialRef = useRef(initial);

  // Register the initial value synchronously so setPageState knows the
  // defaults even on the very first write (called during render, ref mutation
  // is safe and doesn't trigger re-renders).
  registerPageInitial(key, initialRef.current);

  const state    = key in pageStore ? pageStore[key] : initialRef.current;
  const setState = useCallback(
    updater => setPageState(key, updater),
    [key, setPageState]
  );
  return [state, setState];
}

function AuthProvider({ children }) {
  const [user,        setUser]    = useState(null);
  const [token,       setToken]   = useState(localStorage.getItem('soc_token'));
  const [initialising, setInit]   = useState(!!localStorage.getItem('soc_token'));
  const [pageStore, setPageStoreRaw] = useState({});
  // Holds the initial values declared by each usePageState call so
  // setPageState can use them as the base when the key is first written.
  const pageInitials = useRef({});

  function registerPageInitial(key, initial) {
    if (!(key in pageInitials.current)) pageInitials.current[key] = initial;
  }

  // Merge-update a single page's slice of the store
  const setPageState = useCallback((key, updater) => {
    setPageStoreRaw(prev => {
      const base = prev[key] ?? pageInitials.current[key] ?? {};
      return {
        ...prev,
        [key]: typeof updater === 'function' ? updater(base) : updater,
      };
    });
  }, []);

  useEffect(() => {
    if (token) {
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(u => { u ? setUser(u) : logout(); })
        .catch(() => logout())
        .finally(() => setInit(false));
    } else {
      setInit(false);
    }
  }, [token]);

  function login(tok, u) {
    localStorage.setItem('soc_token', tok);
    setToken(tok);
    setUser(u);
  }

  function logout() {
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem('soc_token');
    setToken(null);
    setUser(null);
  }

  const apiFetch = useCallback(async (path, opts = {}) => {
    const res = await fetch(path, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers }
    });
    if (res.status === 401) { logout(); return null; }
    return res;
  }, [token]);

  return (
    <AuthCtx.Provider value={{ user, token, login, logout, apiFetch, initialising, pageStore, setPageState, registerPageInitial }}>
      {children}
    </AuthCtx.Provider>
  );
}

// ── Sidebar Nav ────────────────────────────────────────────────
const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/alerts',    icon: ShieldAlert,     label: 'Alerts'     },
  { to: '/triage',    icon: ScanSearch,      label: 'AI Triage'  },
  { to: '/chat',      icon: MessageSquare,   label: 'AI Chat'    },
  { to: '/tools',     icon: Boxes,           label: 'Tools'      },
  { to: '/agents',    icon: Monitor,         label: 'Agents'     },
  { to: '/devices',   icon: Smartphone,      label: 'Devices'    },
  { to: '/reports',   icon: FileText,        label: 'Reports'    },
  { to: '/scheduler', icon: Clock,           label: 'Scheduler'  },
];

function Sidebar({ open, setOpen, onNetworkClick }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() { logout(); navigate('/login'); }

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setOpen(false)} />}

      <aside className={`fixed top-0 left-0 h-screen w-64 bg-gray-950 border-r border-gray-800 z-30 flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="flex items-center gap-3 p-5 border-b border-gray-800">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
            <Shield size={20} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">SOC Portal</p>
            <p className="text-gray-500 text-xs">Open-Source Platform</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white font-medium'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`
              }
              onClick={() => setOpen(false)}
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-800 space-y-0.5">
          <p className="text-gray-600 text-xs font-semibold uppercase tracking-wider px-3 mb-2">External Tools</p>
          <a href="/wazuh/"      target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 hover:text-blue-400 rounded hover:bg-gray-800 transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
            Wazuh Dashboard
          </a>
          <a href="/grafana/"    target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 hover:text-orange-400 rounded hover:bg-gray-800 transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
            Grafana
          </a>
          <a href="/prometheus/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 hover:text-yellow-400 rounded hover:bg-gray-800 transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
            Prometheus
          </a>
          <a href="/opencti/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 hover:text-rose-400 rounded hover:bg-gray-800 transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
            OpenCTI
          </a>
          <a href={`https://${window.location.hostname}:8889`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 hover:text-green-400 rounded hover:bg-gray-800 transition-colors">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
            Velociraptor
          </a>
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 rounded cursor-default">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-700 flex-shrink-0" />
            Zeek (logs only)
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 rounded cursor-default">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-700 flex-shrink-0" />
            Suricata (logs only)
          </div>
        </div>

        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-sm font-medium">{user?.username}</p>
              <p className="text-gray-500 text-xs capitalize">{user?.role}</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={onNetworkClick} className="p-2 text-gray-500 hover:text-blue-400 rounded-lg hover:bg-gray-800 transition-colors" title="Network Access">
                <Network size={16} />
              </button>
              <button onClick={handleLogout} className="p-2 text-gray-500 hover:text-red-400 rounded-lg hover:bg-gray-800 transition-colors" title="Logout">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

// ── Protected Layout ───────────────────────────────────────────
function Layout() {
  const { user, initialising } = useAuth();
  const [open,       setOpen]       = useState(false);
  const [showNetwork, setShowNetwork] = useState(false);
  const location = useLocation();
  const onChat = location.pathname === '/chat';

  if (initialising) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
          <Shield size={22} className="text-white" />
        </div>
        <p className="text-gray-500 text-sm">Restoring session…</p>
      </div>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-gray-900 text-white flex">
      {showNetwork && <NetworkModal onClose={() => setShowNetwork(false)} />}
      <Sidebar open={open} setOpen={setOpen} onNetworkClick={() => setShowNetwork(true)} />
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        <header className="lg:hidden flex items-center justify-between p-4 bg-gray-950 border-b border-gray-800">
          <button onClick={() => setOpen(true)} className="text-gray-400 hover:text-white">
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-blue-500" />
            <span className="text-white font-bold text-sm">SOC Portal</span>
          </div>
          <div className="w-6" />
        </header>

        <main className="flex-1 p-6">
          {/*
            Chat is always mounted so in-flight LLM streams survive navigation.
            We show/hide it with CSS rather than mounting/unmounting.
          */}
          <div style={{ display: onChat ? 'block' : 'none' }}>
            <Chat />
          </div>

          {/* All other pages — routed normally */}
          <div style={{ display: onChat ? 'none' : 'block' }}>
            <Routes>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/alerts"    element={<Alerts    />} />
              <Route path="/triage"    element={<Triage    />} />
              <Route path="/tools"     element={<Tools     />} />
              <Route path="/agents"    element={<Agents    />} />
              <Route path="/devices"   element={<Devices   />} />
              <Route path="/reports"   element={<Reports   />} />
              <Route path="/scheduler" element={<Scheduler />} />
              <Route path="/chat"      element={null} />
              <Route path="*"          element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*"     element={<Layout />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

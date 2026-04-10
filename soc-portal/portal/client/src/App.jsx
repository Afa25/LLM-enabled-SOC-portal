import React, { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import Dashboard   from './pages/Dashboard';
import Alerts      from './pages/Alerts';
import Agents      from './pages/Agents';
import Devices     from './pages/Devices';
import Reports     from './pages/Reports';
import Scheduler   from './pages/Scheduler';
import Login       from './pages/Login';
import {
  LayoutDashboard, ShieldAlert, Monitor, Smartphone,
  FileText, Clock, LogOut, Shield, Menu, X
} from 'lucide-react';

// ── Auth Context ───────────────────────────────────────────────
export const AuthCtx = createContext(null);
export function useAuth() { return useContext(AuthCtx); }

function AuthProvider({ children }) {
  const [user,  setUser]  = useState(null);
  const [token, setToken] = useState(localStorage.getItem('soc_token'));

  useEffect(() => {
    if (token) {
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(u => u ? setUser(u) : logout())
        .catch(() => logout());
    }
  }, [token]);

  function login(tok, u) {
    localStorage.setItem('soc_token', tok);
    setToken(tok);
    setUser(u);
  }

  function logout() {
    localStorage.removeItem('soc_token');
    setToken(null);
    setUser(null);
  }

  async function apiFetch(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers }
    });
    if (res.status === 401) { logout(); return null; }
    return res;
  }

  return (
    <AuthCtx.Provider value={{ user, token, login, logout, apiFetch }}>
      {children}
    </AuthCtx.Provider>
  );
}

// ── Sidebar Nav ────────────────────────────────────────────────
const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard'  },
  { to: '/alerts',    icon: ShieldAlert,     label: 'Alerts'     },
  { to: '/agents',    icon: Monitor,         label: 'Agents'     },
  { to: '/devices',   icon: Smartphone,      label: 'Devices'    },
  { to: '/reports',   icon: FileText,        label: 'Reports'    },
  { to: '/scheduler', icon: Clock,           label: 'Scheduler'  },
];

function Sidebar({ open, setOpen }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() { logout(); navigate('/login'); }

  return (
    <>
      {/* Mobile overlay */}
      {open && <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setOpen(false)} />}

      <aside className={`fixed top-0 left-0 h-screen w-64 bg-gray-950 border-r border-gray-800 z-30 flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        {/* Logo */}
        <div className="flex items-center gap-3 p-5 border-b border-gray-800">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
            <Shield size={20} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">SOC Portal</p>
            <p className="text-gray-500 text-xs">Open-Source Platform</p>
          </div>
        </div>

        {/* Nav links */}
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

        {/* Quick links */}
        <div className="p-4 border-t border-gray-800 space-y-1">
          <p className="text-gray-600 text-xs font-semibold uppercase tracking-wider px-3 mb-2">External Tools</p>
          <a href="/wazuh"   target="_blank" className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-blue-400 rounded">↗ Wazuh Dashboard</a>
          <a href="/grafana" target="_blank" className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-orange-400 rounded">↗ Grafana</a>
          <a href="/openvas" target="_blank" className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-green-400 rounded">↗ OpenVAS</a>
        </div>

        {/* User */}
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-sm font-medium">{user?.username}</p>
              <p className="text-gray-500 text-xs capitalize">{user?.role}</p>
            </div>
            <button onClick={handleLogout} className="p-2 text-gray-500 hover:text-red-400 rounded-lg hover:bg-gray-800 transition-colors" title="Logout">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ── Protected Layout ───────────────────────────────────────────
function Layout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-gray-900 text-white flex">
      <Sidebar open={open} setOpen={setOpen} />
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        {/* Mobile header */}
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
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/alerts"    element={<Alerts    />} />
            <Route path="/agents"    element={<Agents    />} />
            <Route path="/devices"   element={<Devices   />} />
            <Route path="/reports"   element={<Reports   />} />
            <Route path="/scheduler" element={<Scheduler />} />
            <Route path="*"          element={<Navigate to="/dashboard" replace />} />
          </Routes>
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

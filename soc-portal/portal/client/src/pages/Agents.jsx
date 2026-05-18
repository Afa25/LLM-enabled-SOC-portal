import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../App';
import {
  Monitor, CheckCircle, XCircle, Clock, Search, RefreshCw,
  Cpu, Globe, Hash, Plus, X, Copy, Check, ChevronRight,
  Shield, Activity, Network, Radar, ScanLine, Bug
} from 'lucide-react';

// ── Tool definitions ──────────────────────────────────────────
function makeCommands(ip, name, os) {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '-') || 'my-agent';

  return {
    wazuh: {
      label:  'Wazuh Agent',
      icon:   Shield,
      color:  'text-blue-400',
      border: 'border-blue-500/20',
      bg:     'bg-blue-500/5',
      desc:   'Full SIEM agent — log collection, FIM, vulnerability detection, active response.',
      steps: os === 'linux' ? [
        {
          title: '1 · Download package',
          lang: 'bash',
          code: `curl -so wazuh-agent.deb \\
  https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.7.3-1_amd64.deb`,
        },
        {
          title: '2 · Install + auto-enroll',
          lang: 'bash',
          code: `WAZUH_MANAGER='${ip}' \\
WAZUH_AGENT_NAME='${safeName}' \\
WAZUH_REGISTRATION_SERVER='${ip}' \\
dpkg -i ./wazuh-agent.deb`,
        },
        {
          title: '3 · Start service',
          lang: 'bash',
          code: `sudo systemctl daemon-reload
sudo systemctl enable wazuh-agent
sudo systemctl start wazuh-agent`,
        },
      ] : [
        {
          title: '1 · Download installer (PowerShell)',
          lang: 'powershell',
          code: `Invoke-WebRequest \`
  -Uri "https://packages.wazuh.com/4.x/windows/wazuh-agent-4.7.3-1.msi" \`
  -OutFile "C:\\wazuh-agent.msi"`,
        },
        {
          title: '2 · Install + auto-enroll',
          lang: 'powershell',
          code: `$env:WAZUH_MANAGER        = '${ip}'
$env:WAZUH_AGENT_NAME     = '${safeName}'
$env:WAZUH_REGISTRATION_SERVER = '${ip}'
Start-Process msiexec.exe \`
  -ArgumentList '/i C:\\wazuh-agent.msi /q' -Wait`,
        },
        {
          title: '3 · Start service',
          lang: 'powershell',
          code: `Start-Service -Name WazuhSvc`,
        },
      ],
    },

    nodeexporter: {
      label:  'Prometheus Node Exporter',
      icon:   Activity,
      color:  'text-orange-400',
      border: 'border-orange-500/20',
      bg:     'bg-orange-500/5',
      desc:   'Exposes hardware and OS metrics (CPU, memory, disk, network) for Prometheus to scrape.',
      steps: os === 'linux' ? [
        {
          title: '1 · Download & install',
          lang: 'bash',
          code: `wget https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz
tar xvfz node_exporter-1.7.0.linux-amd64.tar.gz
sudo mv node_exporter-1.7.0.linux-amd64/node_exporter /usr/local/bin/
rm -rf node_exporter-1.7.0.linux-amd64*`,
        },
        {
          title: '2 · Create systemd service',
          lang: 'bash',
          code: `sudo tee /etc/systemd/system/node_exporter.service > /dev/null <<'EOF'
[Unit]
Description=Prometheus Node Exporter
After=network.target

[Service]
User=nobody
ExecStart=/usr/local/bin/node_exporter
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable node_exporter
sudo systemctl start node_exporter`,
        },
        {
          title: '3 · Add scrape target to Prometheus',
          lang: 'yaml',
          code: `# Edit configs/prometheus/prometheus.yml on the SOC server,
# add this under scrape_configs:
  - job_name: '${safeName}'
    static_configs:
      - targets: ['${ip}:9100']`,
        },
      ] : [
        {
          title: '1 · Download Windows Exporter',
          lang: 'powershell',
          code: `Invoke-WebRequest \`
  -Uri "https://github.com/prometheus-community/windows_exporter/releases/download/v0.25.1/windows_exporter-0.25.1-amd64.msi" \`
  -OutFile "C:\\windows_exporter.msi"
Start-Process msiexec.exe -ArgumentList '/i C:\\windows_exporter.msi /q' -Wait`,
        },
        {
          title: '2 · Add scrape target to Prometheus',
          lang: 'yaml',
          code: `# Edit configs/prometheus/prometheus.yml on the SOC server:
  - job_name: '${safeName}'
    static_configs:
      - targets: ['${ip}:9182']`,
        },
      ],
    },

    crowdsec: {
      label:  'CrowdSec Agent',
      icon:   Radar,
      color:  'text-cyan-400',
      border: 'border-cyan-500/20',
      bg:     'bg-cyan-500/5',
      desc:   'Collaborative threat intelligence — analyzes logs, shares ban decisions with the SOC LAPI.',
      steps: os === 'linux' ? [
        {
          title: '1 · Install CrowdSec',
          lang: 'bash',
          code: `curl -s https://packagecloud.io/install/repositories/crowdsec/crowdsec/script.deb.sh | sudo bash
sudo apt install -y crowdsec`,
        },
        {
          title: '2 · Register with SOC LAPI',
          lang: 'bash',
          code: `sudo cscli lapi register --url http://${ip}:${8080}
# Then on the SOC server, accept the machine:
#   docker exec soc-crowdsec cscli machines validate <machine-id>`,
        },
        {
          title: '3 · Install nginx bouncer (optional)',
          lang: 'bash',
          code: `sudo apt install -y crowdsec-nginx-bouncer`,
        },
      ] : [
        {
          title: '1 · Install CrowdSec (PowerShell)',
          lang: 'powershell',
          code: `Invoke-WebRequest \`
  -Uri "https://github.com/crowdsecurity/crowdsec/releases/latest/download/crowdsec_setup.exe" \`
  -OutFile "C:\\crowdsec_setup.exe"
Start-Process "C:\\crowdsec_setup.exe" -ArgumentList '/S' -Wait`,
        },
        {
          title: '2 · Register with SOC LAPI',
          lang: 'powershell',
          code: `cscli lapi register --url http://${ip}:8080
# Then on the SOC server: docker exec soc-crowdsec cscli machines validate <id>`,
        },
      ],
    },

    zeek: {
      label:  'Zeek (Network Analyser)',
      icon:   Network,
      color:  'text-purple-400',
      border: 'border-purple-500/20',
      bg:     'bg-purple-500/5',
      desc:   'Passively captures and analyses network traffic. Generates conn.log, dns.log, http.log. Linux only.',
      note:   'Zeek requires direct access to a network interface (Linux only).',
      steps: os === 'linux' ? [
        {
          title: '1 · Install Zeek',
          lang: 'bash',
          code: `# Ubuntu/Debian
echo 'deb http://download.opensuse.org/repositories/security:/zeek/xUbuntu_22.04/ /' | \\
  sudo tee /etc/apt/sources.list.d/security:zeek.list
curl -fsSL https://download.opensuse.org/repositories/security:/zeek/xUbuntu_22.04/Release.key | \\
  sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/security_zeek.gpg
sudo apt update && sudo apt install -y zeek`,
        },
        {
          title: '2 · Configure interface',
          lang: 'bash',
          code: `# Replace eth0 with your actual interface
sudo zeekctl install
sudo sed -i 's/^interface=.*/interface=eth0/' /etc/zeek/node.cfg`,
        },
        {
          title: '3 · Start + configure Wazuh to read logs',
          lang: 'bash',
          code: `sudo zeekctl deploy

# Add to Wazuh ossec.conf on this host so Wazuh ingests Zeek logs:
# <localfile>
#   <log_format>json</log_format>
#   <location>/var/log/zeek/current/conn.log</location>
# </localfile>`,
        },
      ] : [
        { title: 'Not available', lang: 'bash', code: '# Zeek does not support Windows. Use a Linux host.' },
      ],
    },

    suricata: {
      label:  'Suricata (IDS/IPS)',
      icon:   ScanLine,
      color:  'text-yellow-400',
      border: 'border-yellow-500/20',
      bg:     'bg-yellow-500/5',
      desc:   'Network intrusion detection — writes alerts to eve.json which Wazuh ingests. Linux only.',
      note:   'Suricata requires direct network interface access (Linux only).',
      steps: os === 'linux' ? [
        {
          title: '1 · Install Suricata',
          lang: 'bash',
          code: `sudo add-apt-repository ppa:oisf/suricata-stable -y
sudo apt update && sudo apt install -y suricata suricata-update`,
        },
        {
          title: '2 · Update rules + configure interface',
          lang: 'bash',
          code: `sudo suricata-update

# Set your network interface in /etc/suricata/suricata.yaml:
sudo sed -i 's/  - interface: eth0/  - interface: eth0/' /etc/suricata/suricata.yaml`,
        },
        {
          title: '3 · Start + wire into Wazuh',
          lang: 'bash',
          code: `sudo systemctl enable suricata && sudo systemctl start suricata

# Wazuh ossec.conf — add localfile entry to ingest Suricata alerts:
# <localfile>
#   <log_format>json</log_format>
#   <location>/var/log/suricata/eve.json</location>
# </localfile>`,
        },
      ] : [
        { title: 'Not available', lang: 'bash', code: '# Suricata does not support Windows natively. Use a Linux host or WSL2.' },
      ],
    },

    openvas: {
      label:  'OpenVAS (Add Scan Target)',
      icon:   Bug,
      color:  'text-green-400',
      border: 'border-green-500/20',
      bg:     'bg-green-500/5',
      desc:   'OpenVAS scans target hosts for vulnerabilities. No agent needed — add the target IP to the scanner.',
      steps: [
        {
          title: '1 · Open OpenVAS',
          lang: 'bash',
          code: `# Navigate to:  http://${ip}:9392
# Login: admin / SecureOpenVAS1!`,
        },
        {
          title: '2 · Add target via API (optional)',
          lang: 'bash',
          code: `curl -sk -u admin:SecureOpenVAS1! \\
  -X POST "https://${ip}:9392/gmp" \\
  -d '<create_target><name>${safeName}</name><hosts>${ip}</hosts></create_target>'`,
        },
        {
          title: '3 · Allow ICMP + TCP from scanner',
          lang: 'bash',
          code: `# On the target host — allow scanner access:
sudo ufw allow from ${ip} to any
# Or just allow ping:
sudo ufw allow icmp`,
        },
      ],
    },
  };
}

// ── Copy button ───────────────────────────────────────────────
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors bg-gray-700 hover:bg-gray-600 text-gray-300">
      {copied ? <><Check size={11} className="text-green-400" /> Copied</> : <><Copy size={11} /> Copy</>}
    </button>
  );
}

// ── Code block ────────────────────────────────────────────────
function CodeBlock({ title, code }) {
  return (
    <div className="space-y-1.5">
      {title && <p className="text-xs font-semibold text-gray-400">{title}</p>}
      <div className="relative group">
        <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-green-300 font-mono overflow-x-auto whitespace-pre leading-relaxed">
          {code}
        </pre>
        <div className="absolute top-2 right-2">
          <CopyBtn text={code} />
        </div>
      </div>
    </div>
  );
}

// ── Enrollment modal ──────────────────────────────────────────
const TOOL_ORDER = ['wazuh', 'nodeexporter', 'crowdsec', 'zeek', 'suricata', 'openvas'];

function EnrollModal({ onClose, serverHint }) {
  const [ip,      setIp]      = useState(serverHint || 'YOUR-SERVER-IP');
  const [name,    setName]    = useState('my-agent');
  const [os,      setOs]      = useState('linux');
  const [tool,    setTool]    = useState('wazuh');

  const cmds = makeCommands(ip, name, os);
  const current = cmds[tool];
  const Icon = current.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600/10 rounded-lg border border-blue-600/20">
              <Plus size={18} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">Add Agent</h2>
              <p className="text-gray-500 text-xs">Generate enrollment commands for your endpoint</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white rounded-lg hover:bg-gray-800 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5 overflow-y-auto">

          {/* Config inputs */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1.5">SOC Server IP / Hostname</label>
              <input
                value={ip} onChange={e => setIp(e.target.value)}
                placeholder="e.g. 192.168.1.50"
                className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1.5">Agent / Hostname</label>
              <input
                value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. web-server-01"
                className="w-full bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* OS selector */}
          <div className="flex gap-2">
            {['linux', 'windows'].map(o => (
              <button key={o} onClick={() => setOs(o)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors capitalize ${
                  os === o
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-gray-900 text-gray-400 border-gray-700 hover:border-gray-600'
                }`}>
                {o === 'linux' ? '🐧 Linux' : '🪟 Windows'}
              </button>
            ))}
          </div>

          {/* Tool tabs */}
          <div className="flex flex-wrap gap-2">
            {TOOL_ORDER.map(key => {
              const t    = cmds[key];
              const TIcon = t.icon;
              return (
                <button key={key} onClick={() => setTool(key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    tool === key
                      ? `${t.bg} ${t.color} ${t.border}`
                      : 'bg-gray-900 text-gray-500 border-gray-800 hover:border-gray-700 hover:text-gray-300'
                  }`}>
                  <TIcon size={13} />
                  {t.label.split(' ')[0]}
                </button>
              );
            })}
          </div>

          {/* Active tool panel */}
          <div className={`rounded-xl border p-4 space-y-4 ${current.bg} ${current.border}`}>
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg bg-gray-950/60 border ${current.border} flex-shrink-0`}>
                <Icon size={16} className={current.color} />
              </div>
              <div>
                <p className={`font-semibold text-sm ${current.color}`}>{current.label}</p>
                <p className="text-gray-400 text-xs mt-0.5">{current.desc}</p>
                {current.note && (
                  <p className="text-yellow-500/80 text-xs mt-1">⚠ {current.note}</p>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {current.steps.map((step, i) => (
                <CodeBlock key={i} title={step.title} code={step.code} />
              ))}
            </div>
          </div>

          {/* Footer hint */}
          <div className="flex items-start gap-2 p-3 bg-gray-900 rounded-lg border border-gray-800 text-xs text-gray-500">
            <ChevronRight size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />
            <span>
              After enrolling, refresh the agent list to see the new agent appear.
              Wazuh agents may take up to 60 seconds to show as Active.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Agent card ────────────────────────────────────────────────
function AgentCard({ agent }) {
  const isActive  = agent.status === 'active';
  const osName    = agent?.os?.name  || agent?.os?.platform || '—';
  const osVersion = agent?.os?.version || '';
  const lastSeen  = agent.lastKeepAlive
    ? new Date(agent.lastKeepAlive).toLocaleString()
    : '—';

  return (
    <div className={`bg-gray-900 rounded-xl border p-5 flex flex-col gap-3 transition-colors ${isActive ? 'border-green-500/20' : 'border-gray-800'}`}>
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
      {agent.version && (
        <div className="pt-2 border-t border-gray-800">
          <span className="text-xs font-mono text-blue-400/70">v{agent.version}</span>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function Agents() {
  const { apiFetch }  = useAuth();
  const [agents,      setAgents]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [showModal,   setShowModal]   = useState(false);
  const [serverHint,  setServerHint]  = useState('');

  async function load() {
    setLoading(true);
    const res  = await apiFetch('/api/agents');
    const data = await res?.json();
    setAgents(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Pre-fetch server info for the modal
    apiFetch('/api/agents/enroll-info')
      .then(r => r?.json())
      .then(d => { if (d?.server_hint) setServerHint(d.server_hint); });
  }, []);

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
      {showModal && (
        <EnrollModal
          serverHint={serverHint}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Agents</h1>
          <p className="text-gray-500 text-sm mt-0.5">Monitored endpoints connected to Wazuh Manager</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors">
            <Plus size={15} /> Add Agent
          </button>
          <button onClick={load}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
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
          <p className="font-medium text-gray-500">{search ? 'No agents match your search' : 'No agents enrolled yet'}</p>
          <p className="text-sm mt-1">
            {search ? 'Try a different search term' : (
              <button onClick={() => setShowModal(true)} className="text-blue-400 hover:underline">
                Click Add Agent to enroll your first endpoint →
              </button>
            )}
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

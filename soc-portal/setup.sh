#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║        SOC Portal — Interactive Setup & Management (Linux/macOS)    ║
# ║  Usage:  ./setup.sh [start|stop|restart|status|logs|reconfigure]    ║
# ╚══════════════════════════════════════════════════════════════════════╝

# Don't use -e here; interactive read returns non-zero on EOF
set -uo pipefail

# ── Colours ───────────────────────────────────────────────────────────
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
BLUE="\033[0;34m"
DIM="\033[2m"
RESET="\033[0m"

# ── Compose detection ─────────────────────────────────────────────────
COMPOSE="docker compose"
docker compose version &>/dev/null 2>&1 || COMPOSE="docker-compose"

# ── Output helpers ────────────────────────────────────────────────────
banner() {
  echo -e "${CYAN}"
  echo "  ███████╗ ██████╗  ██████╗    ██████╗  ██████╗ ██████╗ ████████╗ █████╗ ██╗"
  echo "  ██╔════╝██╔═══██╗██╔════╝    ██╔══██╗██╔═══██╗██╔══██╗╚══██╔══╝██╔══██╗██║"
  echo "  ███████╗██║   ██║██║         ██████╔╝██║   ██║██████╔╝   ██║   ███████║██║"
  echo "  ╚════██║██║   ██║██║         ██╔═══╝ ██║   ██║██╔══██╗   ██║   ██╔══██║██║"
  echo "  ███████║╚██████╔╝╚██████╗    ██║     ╚██████╔╝██║  ██║   ██║   ██║  ██║███████╗"
  echo "  ╚══════╝ ╚═════╝  ╚═════╝    ╚═╝      ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝"
  echo -e "${RESET}"
  echo -e "  ${BOLD}LLM-Enabled Security Operations Center${RESET}"
  echo -e "  ${DIM}Wazuh · Grafana · OpenCTI · Velociraptor · Ollama${RESET}"
  echo ""
}

heading()  { echo -e "\n${BOLD}${BLUE}  ── $* ──────────────────────────────────────${RESET}"; }
ok()       { echo -e "  ${GREEN}✓${RESET}  $*"; }
info()     { echo -e "  ${CYAN}·${RESET}  $*"; }
warn()     { echo -e "  ${YELLOW}⚠${RESET}  $*"; }
err()      { echo -e "  ${RED}✗${RESET}  $*"; }
blank()    { echo ""; }

# ── Input helpers ─────────────────────────────────────────────────────
# All ask() variants store result in global _INPUT
_INPUT=""

ask() {
  # ask "Prompt text" "default"
  local prompt="$1" default="${2:-}"
  if [ -n "$default" ]; then
    printf "  ${BOLD}%s${RESET} [${CYAN}%s${RESET}]: " "$prompt" "$default"
  else
    printf "  ${BOLD}%s${RESET}: " "$prompt"
  fi
  read -r _INPUT || true
  [ -z "$_INPUT" ] && _INPUT="$default"
}

ask_secret() {
  # ask_secret "Prompt text" "default"
  local prompt="$1" default="${2:-}"
  printf "  ${BOLD}%s${RESET}: " "$prompt"
  read -rs _INPUT || true
  echo ""
  [ -z "$_INPUT" ] && _INPUT="$default"
}

confirm() {
  # confirm "Question?" → returns 0 for yes, 1 for no
  ask "$1 (y/n)" "y"
  [[ "$_INPUT" =~ ^[Yy]$ ]]
}

# ── Crypto helpers ────────────────────────────────────────────────────
gen_password() {
  # 20-char password from urandom, filtered to safe chars
  tr -dc 'A-Za-z0-9!@#%^&*' </dev/urandom 2>/dev/null | head -c 20
}

gen_hex32() {
  # 64-char hex string (32 bytes)
  if command -v openssl &>/dev/null; then
    openssl rand -hex 32
  else
    tr -dc '0-9a-f' </dev/urandom | head -c 64
  fi
}

gen_uuid() {
  if command -v python3 &>/dev/null; then
    python3 -c "import uuid; print(uuid.uuid4())"
  elif command -v uuidgen &>/dev/null; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    printf '%08x-%04x-4%03x-%04x-%012x\n' \
      "$((RANDOM * RANDOM))" "$((RANDOM % 65536))" \
      "$((RANDOM % 4096))" "$(( (RANDOM % 16384) + 32768 ))" \
      "$((RANDOM * RANDOM * RANDOM))"
  fi
}

b64encode() {
  echo -n "$1" | base64 | tr -d '\n'
}

# ── System detection ──────────────────────────────────────────────────
detect_ip() {
  local ip=""
  # Try ip route first (Linux)
  ip=$(ip route get 8.8.8.8 2>/dev/null | awk 'NR==1{print $7}') || true
  # Fallback: hostname -I (Linux)
  [ -z "$ip" ] && ip=$(hostname -I 2>/dev/null | awk '{print $1}') || true
  # Fallback: ifconfig (macOS)
  [ -z "$ip" ] && ip=$(ifconfig 2>/dev/null | awk '/inet /{print $2}' | grep -v '^127\.' | head -1) || true
  echo "${ip:-}"
}

detect_interfaces() {
  local ifaces=""
  if command -v ip &>/dev/null; then
    ifaces=$(ip link show 2>/dev/null | awk -F': ' '/^[0-9]+:/{print $2}' | grep -v '^lo$' | head -10) || true
  elif command -v ifconfig &>/dev/null; then
    ifaces=$(ifconfig -a 2>/dev/null | awk '/^[a-z]/{gsub(/:$/,"",$1); print $1}' | grep -v '^lo$' | head -10) || true
  fi
  echo "${ifaces:-eth0}"
}

# ── Kernel tuning (Linux only) ────────────────────────────────────────
tune_kernel() {
  # vm.max_map_count must be >= 262144 for Elasticsearch and OpenSearch.
  # Docker Desktop pre-sets this in its VM; native Linux does not.
  if [ "$(uname -s)" = "Linux" ]; then
    local current
    current=$(sysctl -n vm.max_map_count 2>/dev/null || echo 0)
    if [ "$current" -lt 262144 ]; then
      info "Setting vm.max_map_count=262144 (required for Wazuh + OpenCTI)..."
      if sudo sysctl -w vm.max_map_count=262144 &>/dev/null; then
        ok "vm.max_map_count set to 262144"
        # Make it persistent across reboots
        if ! grep -q "vm.max_map_count" /etc/sysctl.conf 2>/dev/null; then
          echo "vm.max_map_count=262144" | sudo tee -a /etc/sysctl.conf >/dev/null
          ok "Persisted to /etc/sysctl.conf"
        fi
      else
        warn "Could not set vm.max_map_count — run: sudo sysctl -w vm.max_map_count=262144"
      fi
    else
      ok "vm.max_map_count=$current (OK)"
    fi
  fi
}

# ── Prerequisites ─────────────────────────────────────────────────────
check_deps() {
  heading "Checking prerequisites"
  local fail=0

  tune_kernel

  if command -v docker &>/dev/null; then
    ok "Docker: $(docker --version 2>&1 | head -1)"
  else
    err "Docker not found."
    info "Install: https://docs.docker.com/engine/install/"
    fail=1
  fi

  if $COMPOSE version &>/dev/null 2>&1; then
    ok "Docker Compose: $($COMPOSE version 2>&1 | head -1)"
  else
    err "Docker Compose not found."
    fail=1
  fi

  if command -v openssl &>/dev/null; then
    ok "OpenSSL found"
  else
    warn "OpenSSL not found — random secrets will use /dev/urandom fallback"
  fi

  if [ $fail -eq 1 ]; then
    blank
    err "Fix the above issues and re-run."
    exit 1
  fi
}

# ── Setup wizard ──────────────────────────────────────────────────────
run_wizard() {
  heading "First-time setup wizard"
  blank
  echo -e "  I'll ask a few questions then build and start everything."
  echo -e "  Press ${BOLD}Enter${RESET} to accept the ${CYAN}[default]${RESET}."
  blank

  # ── Server address ─────────────────────────────────────────────────
  heading "Server address"
  echo -e "  The IP or hostname remote agents will use to reach this server."
  echo -e "  Also used in the portal's agent enrollment guide."
  blank
  local auto_ip
  auto_ip=$(detect_ip)
  ask "Server IP or hostname" "${auto_ip:-192.168.1.100}"
  local SERVER_IP="$_INPUT"
  ok "Server address: $SERVER_IP"
  blank

  # ── Network interface ──────────────────────────────────────────────
  heading "Network interface"
  echo -e "  Used by Zeek and Suricata for packet capture (IDS/IPS)."
  blank
  local ifaces
  ifaces=$(detect_interfaces)
  local i=1
  local iface_list=()
  echo -e "  Available interfaces:"
  while IFS= read -r iface; do
    [ -z "$iface" ] && continue
    echo -e "    ${CYAN}$i${RESET}) $iface"
    iface_list+=("$iface")
    ((i++)) || true
  done <<< "$ifaces"
  blank
  local first_iface="${iface_list[0]:-eth0}"
  ask "Interface name or number" "$first_iface"
  local NET_IFACE="$_INPUT"
  # Resolve number to name
  if [[ "$NET_IFACE" =~ ^[0-9]+$ ]]; then
    local idx=$(( NET_IFACE - 1 ))
    NET_IFACE="${iface_list[$idx]:-$first_iface}"
  fi
  ok "Using interface: $NET_IFACE"
  blank

  # ── Packet capture ─────────────────────────────────────────────
  heading "Packet capture (Zeek / Suricata IDS)"
  warn "Requires Linux with network_mode: host"
  warn "NOT supported on Docker Desktop (Windows/Mac)"
  blank
  confirm "Enable Zeek and Suricata for packet capture?"
  local ENABLE_IDS
  if [ $? -eq 0 ]; then ENABLE_IDS="true"; else ENABLE_IDS="false"; fi
  ok "Packet capture: $ENABLE_IDS"
  blank

  # ── LLM model ──────────────────────────────────────────────────────
  heading "LLM model (for AI-assisted threat analysis)"
  echo -e "    ${CYAN}1${RESET}) llama3.2:3b   — 2 GB RAM  ${GREEN}[recommended]${RESET}"
  echo -e "    ${CYAN}2${RESET}) phi3:mini      — 2 GB RAM, very fast"
  echo -e "    ${CYAN}3${RESET}) mistral:7b     — 5 GB RAM, better quality"
  echo -e "    ${CYAN}4${RESET}) llama3.1:8b    — 6 GB RAM, best quality"
  blank
  ask "Model name or number" "1"
  local LLM_MODEL
  case "$_INPUT" in
    1|"")  LLM_MODEL="llama3.2:3b" ;;
    2)     LLM_MODEL="phi3:mini" ;;
    3)     LLM_MODEL="mistral:7b" ;;
    4)     LLM_MODEL="llama3.1:8b" ;;
    *)     LLM_MODEL="$_INPUT" ;;
  esac
  ok "LLM model: $LLM_MODEL"
  blank

  # ── Optional heavy services ────────────────────────────────────────
  heading "Optional services (OpenCTI + Velociraptor)"
  info "OpenCTI is a threat-intelligence platform (~3 GB RAM)"
  info "Velociraptor is a DFIR endpoint-visibility tool (~256 MB RAM)"
  warn "Combined: ~3.3 GB extra RAM. Disable on low-memory servers."
  blank
  confirm "Enable OpenCTI and Velociraptor?"
  local ENABLE_FULL
  if [ $? -eq 0 ]; then ENABLE_FULL="full"; else ENABLE_FULL=""; fi
  ok "Optional services: ${ENABLE_FULL:-disabled}"
  blank

  # ── OpenCTI email ──────────────────────────────────────────────────
  heading "OpenCTI admin account"
  ask "Admin email" "admin@soc.local"
  local OPENCTI_EMAIL="$_INPUT"
  blank

  # ── Passwords ──────────────────────────────────────────────────────
  heading "Passwords"
  echo -e "  ${BOLD}A)${RESET} Auto-generate all passwords  ${GREEN}[recommended]${RESET}"
  echo -e "  ${BOLD}B)${RESET} Set passwords manually"
  blank
  confirm "Auto-generate all passwords?"
  local AUTO=$?

  local PORTAL_PASS WAZUH_API_PASS WAZUH_INDEXER_PASS WAZUH_DASHBOARD_PASS
  local GRAFANA_PASS OPENCTI_PASS OPENCTI_RABBIT_PASS OPENCTI_MINIO_PASS VELO_PASS

  if [ $AUTO -eq 0 ]; then
    PORTAL_PASS=$(gen_password)
    WAZUH_API_PASS=$(gen_password)
    WAZUH_INDEXER_PASS=$(gen_password)
    WAZUH_DASHBOARD_PASS=$(gen_password)
    GRAFANA_PASS=$(gen_password)
    OPENCTI_PASS=$(gen_password)
    OPENCTI_RABBIT_PASS=$(gen_password)
    OPENCTI_MINIO_PASS=$(gen_password)
    VELO_PASS=$(gen_password)
    ok "All passwords generated"
  else
    blank
    echo -e "  ${DIM}Leave blank to keep the default shown, or type a new value.${RESET}"
    blank
    ask_secret  "Portal admin password"      "ChangeThisPortalPassword1!"
    PORTAL_PASS="$_INPUT"
    ask_secret  "Wazuh API password"          "ChangeThisWazuhPassword1!"
    WAZUH_API_PASS="$_INPUT"
    ask_secret  "Wazuh Indexer password"      "ChangeThisIndexerPassword1!"
    WAZUH_INDEXER_PASS="$_INPUT"
    ask_secret  "Wazuh Dashboard password"    "ChangeThisDashboardPassword1!"
    WAZUH_DASHBOARD_PASS="$_INPUT"
    ask_secret  "Grafana password"            "ChangeThisGrafanaPassword1!"
    GRAFANA_PASS="$_INPUT"
    ask_secret  "OpenCTI admin password"      "ChangeThisOpenCTI1!"
    OPENCTI_PASS="$_INPUT"
    ask_secret  "OpenCTI RabbitMQ password"   "ChangeThisRabbitMQ1!"
    OPENCTI_RABBIT_PASS="$_INPUT"
    ask_secret  "OpenCTI MinIO password"      "ChangeThisMinio1!"
    OPENCTI_MINIO_PASS="$_INPUT"
    ask_secret  "Velociraptor admin password" "ChangeThisVelo1!"
    VELO_PASS="$_INPUT"
  fi

  # ── Generate secrets ───────────────────────────────────────────────
  heading "Generating cryptographic secrets"
  local JWT_SECRET
  JWT_SECRET=$(gen_hex32)
  ok "JWT secret (64-char hex)"

  local OPENCTI_TOKEN
  OPENCTI_TOKEN=$(gen_uuid)
  ok "OpenCTI admin token (UUID)"

  local WAZUH_BASIC_AUTH_B64
  WAZUH_BASIC_AUTH_B64=$(b64encode "admin:${WAZUH_INDEXER_PASS}")
  ok "Wazuh Basic Auth header (nginx proxy)"

  # ── Write .env ─────────────────────────────────────────────────────
  heading "Writing configuration"

  cat > .env <<EOF
# ============================================================
# SOC Portal — Environment Configuration
# Generated by setup.sh on $(date '+%Y-%m-%d %H:%M:%S')
# ⚠  NEVER commit this file to version control.
# ============================================================

# ── Portal auth ──────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}
PORTAL_USER=admin
PORTAL_PASS=${PORTAL_PASS}

# ── Wazuh ────────────────────────────────────────────────────
WAZUH_API_PASSWORD=${WAZUH_API_PASS}
WAZUH_INDEXER_PASSWORD=${WAZUH_INDEXER_PASS}
WAZUH_DASHBOARD_PASSWORD=${WAZUH_DASHBOARD_PASS}
# Base64 of "admin:<WAZUH_INDEXER_PASSWORD>" — used by nginx proxy header
WAZUH_BASIC_AUTH_B64=${WAZUH_BASIC_AUTH_B64}
WAZUH_TLS_SKIP_VERIFY=false

# ── Grafana ───────────────────────────────────────────────────
GRAFANA_USER=admin
GRAFANA_PASSWORD=${GRAFANA_PASS}

# ── OpenCTI ───────────────────────────────────────────────────
OPENCTI_ADMIN_EMAIL=${OPENCTI_EMAIL}
OPENCTI_ADMIN_PASSWORD=${OPENCTI_PASS}
OPENCTI_ADMIN_TOKEN=${OPENCTI_TOKEN}
OPENCTI_RABBITMQ_USER=opencti
OPENCTI_RABBITMQ_PASS=${OPENCTI_RABBIT_PASS}
OPENCTI_MINIO_USER=opencti
OPENCTI_MINIO_PASS=${OPENCTI_MINIO_PASS}

# ── Velociraptor ──────────────────────────────────────────────
VELOCIRAPTOR_ADMIN_PASSWORD=${VELO_PASS}

# ── Ollama LLM ────────────────────────────────────────────────
OLLAMA_MODEL=${LLM_MODEL}

# ── Network ───────────────────────────────────────────────────
SOC_NETWORK_INTERFACE=${NET_IFACE}
SERVER_IP=${SERVER_IP}

# ── Packet capture ────────────────────────────────────────────
ENABLE_PACKET_CAPTURE=${ENABLE_IDS}

# ── Optional services (OpenCTI + Velociraptor) ────────────────
# Set to 'full' to enable; leave empty to run core services only
# Saves ~3.3 GB RAM when disabled
COMPOSE_PROFILES=${ENABLE_FULL}
EOF

  ok ".env written"

  # ── Save credentials summary ───────────────────────────────────────
  cat > credentials.txt <<EOF
╔══════════════════════════════════════════════════════════════════╗
║                SOC Portal — Access Credentials                   ║
║            Generated: $(date '+%Y-%m-%d %H:%M:%S')                  ║
╚══════════════════════════════════════════════════════════════════╝

  SOC Portal       https://${SERVER_IP}
  Username:        admin
  Password:        ${PORTAL_PASS}

  Grafana          https://${SERVER_IP}/grafana
  Username:        admin
  Password:        ${GRAFANA_PASS}

  Wazuh Dashboard  https://${SERVER_IP}/wazuh
  Username:        admin
  Password:        ${WAZUH_INDEXER_PASS}

  OpenCTI          https://${SERVER_IP}/opencti
  Email:           ${OPENCTI_EMAIL}
  Password:        ${OPENCTI_PASS}
  API Token:       ${OPENCTI_TOKEN}

  Velociraptor     https://${SERVER_IP}:8889
  Username:        admin
  Password:        ${VELO_PASS}

  Wazuh Agent Enrollment
  Manager IP:      ${SERVER_IP}
  Enroll port:     1515
  Events port:     1514

══════════════════════════════════════════════════════════════════
  ⚠  STORE THIS FILE SAFELY — DELETE AFTER RECORDING PASSWORDS
══════════════════════════════════════════════════════════════════
EOF

  warn "Credentials saved to ${BOLD}credentials.txt${RESET}"
  blank
}

# ── Health wait ───────────────────────────────────────────────────────
wait_healthy() {
  local container="$1" max="${2:-90}" elapsed=0
  printf "  ${CYAN}·${RESET}  Waiting for %s" "$container"
  while [ "$elapsed" -lt "$max" ]; do
    local status
    status=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "missing")
    case "$status" in
      healthy)
        echo -e "\r  ${GREEN}✓${RESET}  $container is healthy          "
        return 0 ;;
      starting|missing)
        sleep 4; elapsed=$((elapsed + 4))
        printf "\r  ${CYAN}·${RESET}  Waiting for %s... (%ds)" "$container" "$elapsed" ;;
      *)
        echo -e "\r  ${YELLOW}⚠${RESET}  $container status: $status — continuing"
        return 0 ;;
    esac
  done
  echo -e "\r  ${YELLOW}⚠${RESET}  $container not healthy after ${max}s — continuing"
}

# ── Commands ──────────────────────────────────────────────────────────
cmd_start() {
  banner
  check_deps

  if [ ! -f .env ]; then
    run_wizard
    blank
    confirm "Start the platform now?"
    [ $? -ne 0 ] && { info "Run ./setup.sh start when ready."; exit 0; }
  fi

  heading "Starting SOC Platform"
  info "Building images and starting containers..."
  info "First run may take 10–20 minutes (image downloads + LLM model pull)."
  blank

  local ids_enabled
  ids_enabled=$(grep '^ENABLE_PACKET_CAPTURE=' .env 2>/dev/null | cut -d= -f2 || echo "false")

  $COMPOSE up -d --build

  if [ "$ids_enabled" = "true" ]; then
    local ids_iface
    ids_iface=$(grep '^SOC_NETWORK_INTERFACE=' .env 2>/dev/null | cut -d= -f2 || echo "eth0")
    info "Packet capture (Zeek/Suricata) active on interface: $ids_iface"
  else
    $COMPOSE stop zeek suricata 2>/dev/null || true
    info "Packet capture (Zeek/Suricata) skipped — use: ./setup.sh packet-capture start"
  fi

  heading "Waiting for core services"
  wait_healthy "soc-wazuh-indexer" 150
  wait_healthy "soc-portal"         60
  wait_healthy "soc-grafana"        30

  local SERVER_IP
  SERVER_IP=$(grep '^SERVER_IP=' .env 2>/dev/null | cut -d= -f2 || true)
  SERVER_IP="${SERVER_IP:-<your-server-ip>}"

  blank
  echo -e "${GREEN}${BOLD}  ╔═══════════════════════════════════════════════════════╗${RESET}"
  echo -e "${GREEN}${BOLD}  ║              SOC PORTAL IS RUNNING                   ║${RESET}"
  echo -e "${GREEN}${BOLD}  ╚═══════════════════════════════════════════════════════╝${RESET}"
  blank
  echo -e "  ${BOLD}SOC Portal:${RESET}      ${CYAN}https://${SERVER_IP}${RESET}"
  echo -e "  ${BOLD}Grafana:${RESET}         ${CYAN}https://${SERVER_IP}/grafana${RESET}"
  echo -e "  ${BOLD}Wazuh:${RESET}           ${CYAN}https://${SERVER_IP}/wazuh${RESET}"
  echo -e "  ${BOLD}OpenCTI:${RESET}         ${CYAN}https://${SERVER_IP}/opencti${RESET}"
  echo -e "  ${BOLD}Velociraptor:${RESET}    ${CYAN}https://${SERVER_IP}:8889${RESET}"
  echo -e "  ${BOLD}Prometheus:${RESET}      ${CYAN}https://${SERVER_IP}/prometheus${RESET}"
  blank
  echo -e "  ${BOLD}Credentials:${RESET}     ${YELLOW}./credentials.txt${RESET}"
  blank
  warn "Wazuh indexer needs ~2 min to become fully healthy."
  warn "Ollama pulls the LLM model in the background (~2 GB)."
  warn "OpenCTI takes 3–5 min to initialize on first run."
  blank
  info "Monitor: ${CYAN}./setup.sh logs${RESET}"
  info "Status:  ${CYAN}./setup.sh status${RESET}"
  check_disk_saturation 80
}

# ── Disk saturation check ─────────────────────────────────────────────
check_disk_saturation() {
  local threshold="${1:-80}"
  local pct
  pct=$(df -P . 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}') || return 0
  if [ "${pct:-0}" -ge "$threshold" ] 2>/dev/null; then
    warn "Disk at ${pct}% capacity — run: ${CYAN}./setup.sh export-data${RESET} to free space"
  fi
}

# ── Volume export / purge helpers ─────────────────────────────────────
_vol_export() {
  local vol="$1" days="$2" dest="$3"
  info "  Exporting ${vol}..."
  docker run --rm \
    -v "${vol}:/srcdata:ro" \
    -v "${dest}:/destdata" \
    alpine sh -c "
      cd /srcdata
      find . -type f -mtime +${days} > /tmp/fl.txt 2>/dev/null
      if [ -s /tmp/fl.txt ]; then
        tar czf \"/destdata/${vol}.tar.gz\" -T /tmp/fl.txt 2>/dev/null
        echo \"    Archived \$(wc -l < /tmp/fl.txt) files\"
      else
        echo '    No files older than ${days} days in ${vol}'
      fi
    " || warn "${vol} export skipped (volume may not exist)"
}

_vol_purge() {
  local vol="$1" days="$2"
  docker run --rm -v "${vol}:/data" alpine \
    sh -c "find /data -type f -mtime +${days} -delete 2>/dev/null && echo '    Purged ${vol}'" \
    || warn "${vol} purge skipped"
}

cmd_disk_usage() {
  heading "Disk & Volume Usage"
  blank
  info "Host filesystem:"
  df -h . 2>/dev/null | head -3 || true
  blank
  info "Docker system:"
  docker system df 2>/dev/null || true
  check_disk_saturation 80
}

cmd_export_data() {
  local days="${1:-30}"
  local export_root; export_root="$(pwd)/exports"
  local ts; ts=$(date +%Y%m%d_%H%M%S)
  local out_name="soc-export-${ts}"
  local out_dir="${export_root}/${out_name}"

  heading "SOC Data Export — logs older than ${days} days"

  local pct
  pct=$(df -P . 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}') || pct="?"
  info "Disk usage before export: ${pct}%"
  blank

  mkdir -p "$out_dir"

  _vol_export "zeek-logs"     "$days" "$out_dir"
  _vol_export "suricata-logs" "$days" "$out_dir"
  _vol_export "wazuh-logs"    "$days" "$out_dir"

  # Portal database snapshot
  info "  Exporting portal database..."
  docker exec soc-portal sh -c "cp /app/data/soc.db /tmp/portal-db.bak 2>/dev/null && echo '    DB copied'" 2>/dev/null && \
    docker cp soc-portal:/tmp/portal-db.bak "${out_dir}/portal-db.bak" 2>/dev/null || \
    warn "Portal DB export skipped (container may not be running)"

  # Bundle everything into a single archive
  blank
  info "Creating archive..."
  tar czf "${export_root}/${out_name}.tar.gz" -C "$export_root" "$out_name" 2>/dev/null
  rm -rf "$out_dir"

  local sz
  sz=$(du -sh "${export_root}/${out_name}.tar.gz" 2>/dev/null | cut -f1 || echo "?")
  ok "Archive: ${export_root}/${out_name}.tar.gz  (${sz})"
  blank

  confirm "Purge exported data from containers to free disk space?"
  if [ $? -eq 0 ]; then
    blank
    info "Purging old log files from volumes..."
    _vol_purge "zeek-logs"     "$days"
    _vol_purge "suricata-logs" "$days"
    _vol_purge "wazuh-logs"    "$days"
    ok "Old log files purged"
    blank

    confirm "Run Docker system prune (removes build cache and unused images)?"
    if [ $? -eq 0 ]; then
      docker system prune -f 2>/dev/null
      ok "Docker build cache cleared"
    fi

    blank
    local new_pct
    new_pct=$(df -P . 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}') || new_pct="?"
    info "Disk usage after cleanup: ${new_pct}%"
    blank
  fi

  warn "To transfer the archive:"
  info "  scp ${export_root}/${out_name}.tar.gz user@backup-server:/backups/"
}

cmd_packet_capture() {
  local sub="${1:-status}"
  case "$sub" in
    start)
      local iface="${2:-}"
      if [ -n "$iface" ]; then
        sed -i "s/^SOC_NETWORK_INTERFACE=.*/SOC_NETWORK_INTERFACE=${iface}/" .env
        ok "Interface set to: $iface"
      fi
      if grep -q '^ENABLE_PACKET_CAPTURE=' .env 2>/dev/null; then
        sed -i "s/^ENABLE_PACKET_CAPTURE=.*/ENABLE_PACKET_CAPTURE=true/" .env
      else
        echo "ENABLE_PACKET_CAPTURE=true" >> .env
      fi
      info "Starting Zeek and Suricata..."
      $COMPOSE up -d zeek suricata
      ok "Packet capture running"
      ;;
    stop)
      if grep -q '^ENABLE_PACKET_CAPTURE=' .env 2>/dev/null; then
        sed -i "s/^ENABLE_PACKET_CAPTURE=.*/ENABLE_PACKET_CAPTURE=false/" .env
      fi
      $COMPOSE stop zeek suricata
      ok "Packet capture stopped"
      ;;
    interface)
      local new_iface="${2:-}"
      if [ -z "$new_iface" ]; then
        blank
        local ifaces iface_list=()
        ifaces=$(detect_interfaces)
        local i=1
        echo -e "  Available interfaces:"
        while IFS= read -r iline; do
          [ -z "$iline" ] && continue
          echo -e "    ${CYAN}$i${RESET}) $iline"
          iface_list+=("$iline")
          ((i++)) || true
        done <<< "$ifaces"
        blank
        local first_iface="${iface_list[0]:-eth0}"
        ask "Interface name or number" "$first_iface"
        new_iface="$_INPUT"
        if [[ "$new_iface" =~ ^[0-9]+$ ]]; then
          local idx=$(( new_iface - 1 ))
          new_iface="${iface_list[$idx]:-$first_iface}"
        fi
      fi
      sed -i "s/^SOC_NETWORK_INTERFACE=.*/SOC_NETWORK_INTERFACE=${new_iface}/" .env
      ok "Interface set to: $new_iface"
      warn "Restarting Zeek and Suricata to apply..."
      $COMPOSE stop zeek suricata 2>/dev/null || true
      $COMPOSE up -d zeek suricata
      ok "Packet capture restarted on: $new_iface"
      ;;
    status)
      blank
      echo -e "  ${BOLD}Packet capture status:${RESET}"
      local enabled iface
      enabled=$(grep '^ENABLE_PACKET_CAPTURE=' .env 2>/dev/null | cut -d= -f2 || echo "false")
      iface=$(grep '^SOC_NETWORK_INTERFACE=' .env 2>/dev/null | cut -d= -f2 || echo "eth0")
      info "Enabled: $enabled  |  Interface: $iface"
      blank
      $COMPOSE ps zeek suricata
      ;;
    *)
      err "Usage: ./setup.sh packet-capture [start [iface] | stop | interface [iface] | status]"
      ;;
  esac
}

cmd_stop() {
  info "Stopping SOC Platform..."
  $COMPOSE down
  ok "All containers stopped"
}

cmd_restart() {
  info "Restarting SOC Platform..."
  $COMPOSE down
  sleep 2
  cmd_start
}

cmd_status() {
  check_disk_saturation 80
  echo -e "${BOLD}  Container Status${RESET}"
  blank
  $COMPOSE ps
}

cmd_logs() {
  local svc="${2:-}"
  if [ -z "$svc" ]; then
    $COMPOSE logs -f --tail=50
  else
    $COMPOSE logs -f --tail=100 "$svc"
  fi
}

cmd_pull_model() {
  local model="${2:-}"
  if [ -z "$model" ]; then
    blank
    echo -e "  ${BOLD}Available models:${RESET}"
    echo -e "    ${CYAN}1${RESET}) llama3.2:3b   — 2 GB"
    echo -e "    ${CYAN}2${RESET}) phi3:mini      — 2 GB, very fast"
    echo -e "    ${CYAN}3${RESET}) mistral:7b     — 5 GB, better quality"
    echo -e "    ${CYAN}4${RESET}) llama3.1:8b    — 6 GB, best quality"
    blank
    ask "Model name or number" "1"
    case "$_INPUT" in
      1|"") model="llama3.2:3b" ;;
      2)    model="phi3:mini" ;;
      3)    model="mistral:7b" ;;
      4)    model="llama3.1:8b" ;;
      *)    model="$_INPUT" ;;
    esac
  fi
  info "Pulling model: $model  (may take several minutes)"
  docker exec soc-ollama ollama pull "$model"
  sed -i "s/^OLLAMA_MODEL=.*/OLLAMA_MODEL=$model/" .env
  ok "Model $model ready"
  warn "Run ${CYAN}./setup.sh restart${RESET} to apply"
}

cmd_update() {
  info "Pulling latest images..."
  $COMPOSE pull
  $COMPOSE up -d --build
  ok "Update complete"
}

cmd_backup() {
  local ts; ts=$(date +%Y%m%d_%H%M%S)
  local out="backup_${ts}.tar.gz"
  info "Creating backup: $out"
  tar czf "$out" configs/ .env --exclude='configs/nginx/ssl' 2>/dev/null || true
  ok "Backup saved: $out"
}

cmd_reset_password() {
  if [ ! -f .env ]; then
    err ".env not found — run ./setup.sh start first"
    exit 1
  fi

  local user pass
  user=$(grep '^PORTAL_USER=' .env | cut -d= -f2)
  pass=$(grep '^PORTAL_PASS=' .env | cut -d= -f2)
  user="${user:-admin}"

  heading "Reset portal admin password"

  if [ -z "$pass" ]; then
    warn "PORTAL_PASS not found in .env — enter a new password manually"
    ask_secret "New password for '${user}'"
    pass="$_INPUT"
    if [ -z "$pass" ]; then
      err "Password cannot be empty"
      exit 1
    fi
    # Update .env
    sed -i "s/^PORTAL_PASS=.*/PORTAL_PASS=${pass}/" .env
    ok ".env updated"
  fi

  info "Resetting password for user: $user"

  docker exec soc-portal node -e "
    const b = require('bcryptjs');
    const D = require('better-sqlite3');
    const db = new D(require('path').join(process.env.DATA_DIR||'/app/data','soc.db'));
    const hash = b.hashSync('${pass}', 10);
    const u = '${user}';
    const exists = db.prepare('SELECT id FROM users WHERE username=?').get(u);
    if (exists) {
      db.prepare('UPDATE users SET password=? WHERE username=?').run(hash, u);
      console.log('Password updated for:', u);
    } else {
      db.prepare('INSERT INTO users (username,password,role) VALUES (?,?,?)').run(u, hash, 'admin');
      console.log('Admin user created:', u);
    }
    db.close();
  " 2>&1

  if [ $? -eq 0 ]; then
    ok "Done — login with username '${user}' and the password from credentials.txt"
  else
    err "Failed — is the soc-portal container running? Check: ./setup.sh status"
  fi
}

cmd_optional_services() {
  local sub="${1:-status}"
  case "$sub" in
    enable)
      if grep -q '^COMPOSE_PROFILES=' .env 2>/dev/null; then
        sed -i "s/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=full/" .env
      else
        echo "COMPOSE_PROFILES=full" >> .env
      fi
      ok "Optional services enabled (OpenCTI + Velociraptor)"
      info "Run: ${CYAN}./setup.sh start${RESET} to bring them up"
      ;;
    disable)
      if grep -q '^COMPOSE_PROFILES=' .env 2>/dev/null; then
        sed -i "s/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=/" .env
      fi
      $COMPOSE stop opencti opencti-redis opencti-rabbitmq opencti-minio opencti-elasticsearch velociraptor 2>/dev/null || true
      ok "Optional services stopped and disabled"
      info "~3.3 GB RAM freed on next restart"
      ;;
    status)
      local prof
      prof=$(grep '^COMPOSE_PROFILES=' .env 2>/dev/null | cut -d= -f2 || echo "")
      if [ "$prof" = "full" ]; then
        ok "Optional services: ENABLED (OpenCTI + Velociraptor)"
      else
        info "Optional services: disabled — run: ${CYAN}./setup.sh optional-services enable${RESET}"
      fi
      blank
      $COMPOSE ps opencti velociraptor 2>/dev/null || true
      ;;
    *)
      err "Usage: ./setup.sh optional-services [enable | disable | status]"
      ;;
  esac
}

cmd_reconfigure() {
  warn "This will delete .env and re-run the wizard."
  blank
  confirm "Are you sure you want to reconfigure?"
  [ $? -ne 0 ] && { info "Aborted."; exit 0; }
  rm -f .env credentials.txt
  run_wizard
  confirm "Start the platform now?"
  [ $? -eq 0 ] && cmd_start
}

# ── Help ──────────────────────────────────────────────────────────────
usage() {
  blank
  echo -e "  ${BOLD}Usage:${RESET}  ./setup.sh [command]"
  blank
  echo -e "  ${CYAN}Commands:${RESET}"
  echo -e "    ${BOLD}start${RESET}              Start platform (runs wizard if .env is missing)"
  echo -e "    ${BOLD}stop${RESET}               Stop all containers"
  echo -e "    ${BOLD}restart${RESET}            Restart all containers"
  echo -e "    ${BOLD}status${RESET}             Show container status"
  echo -e "    ${BOLD}logs${RESET} [service]                 Stream logs (all, or a specific service)"
  echo -e "    ${BOLD}pull-model${RESET} [name]              Download a different Ollama LLM model"
  echo -e "    ${BOLD}update${RESET}                         Pull latest Docker images and rebuild"
  echo -e "    ${BOLD}backup${RESET}                         Archive configs + .env to a .tar.gz"
  echo -e "    ${BOLD}reconfigure${RESET}                    Re-run the setup wizard"
  echo -e "    ${BOLD}reset-password${RESET}                 Re-apply portal login password from .env"
  echo -e "    ${BOLD}disk-usage${RESET}                     Show host and Docker volume disk usage"
  echo -e "    ${BOLD}export-data${RESET} [days]             Compress + export logs older than N days"
  echo -e "    ${BOLD}packet-capture start${RESET} [iface]        Enable Zeek+Suricata (Linux only)"
  echo -e "    ${BOLD}packet-capture stop${RESET}                Disable Zeek+Suricata"
  echo -e "    ${BOLD}packet-capture interface${RESET} [if]       Change listening interface"
  echo -e "    ${BOLD}packet-capture status${RESET}               Show IDS container status"
  echo -e "    ${BOLD}optional-services enable${RESET}            Start OpenCTI + Velociraptor (+3.3 GB RAM)"
  echo -e "    ${BOLD}optional-services disable${RESET}           Stop OpenCTI + Velociraptor (free RAM)"
  echo -e "    ${BOLD}optional-services status${RESET}            Show optional service state"
  blank
  echo -e "  ${DIM}Example service names for logs:${RESET}"
  echo -e "    soc-portal  soc-wazuh-manager  soc-wazuh-indexer"
  echo -e "    soc-grafana  soc-opencti  soc-velociraptor  soc-ollama"
  blank
}

# ── Entry point ───────────────────────────────────────────────────────
CMD="${1:-start}"
shift 2>/dev/null || true

case "$CMD" in
  start)        cmd_start ;;
  stop)         cmd_stop ;;
  restart)      cmd_restart ;;
  status)       cmd_status ;;
  logs)         cmd_logs "" "$@" ;;
  pull-model)   cmd_pull_model "" "$@" ;;
  update)       cmd_update ;;
  backup)       cmd_backup ;;
  reconfigure)      cmd_reconfigure ;;
  reset-password)   cmd_reset_password ;;
  disk-usage)       cmd_disk_usage ;;
  export-data)      cmd_export_data "$@" ;;
  packet-capture)     cmd_packet_capture "$@" ;;
  optional-services)  cmd_optional_services "$@" ;;
  help|--help|-h)   usage ;;
  *)
    err "Unknown command: $CMD"
    usage
    exit 1 ;;
esac

#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════╗
# ║              SOC PORTAL — SETUP & MANAGEMENT SCRIPT                 ║
# ║   Usage: ./setup.sh [start|stop|restart|status|logs|pull-model]     ║
# ╚══════════════════════════════════════════════════════════════════════╝
set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

COMPOSE="docker compose"
command -v docker compose &>/dev/null || COMPOSE="docker-compose"

banner() {
  echo -e "${CYAN}"
  echo "  ███████╗ ██████╗  ██████╗    ██████╗  ██████╗ ██████╗ ████████╗ █████╗ ██╗"
  echo "  ██╔════╝██╔═══██╗██╔════╝    ██╔══██╗██╔═══██╗██╔══██╗╚══██╔══╝██╔══██╗██║"
  echo "  ███████╗██║   ██║██║         ██████╔╝██║   ██║██████╔╝   ██║   ███████║██║"
  echo "  ╚════██║██║   ██║██║         ██╔═══╝ ██║   ██║██╔══██╗   ██║   ██╔══██║██║"
  echo "  ███████║╚██████╔╝╚██████╗    ██║     ╚██████╔╝██║  ██║   ██║   ██║  ██║███████╗"
  echo "  ╚══════╝ ╚═════╝  ╚═════╝    ╚═╝      ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝"
  echo -e "${RESET}"
  echo -e "  ${BOLD}Open-Source Security Operations Center${RESET}"
  echo -e "  Wazuh · Grafana · Zeek · Suricata · OpenVAS · Ollama LLM"
  echo ""
}

check_deps() {
  echo -e "${YELLOW}Checking dependencies...${RESET}"
  command -v docker &>/dev/null || { echo -e "${RED}Docker not found. Install from https://docs.docker.com/get-docker/${RESET}"; exit 1; }
  $COMPOSE version &>/dev/null   || { echo -e "${RED}Docker Compose not found.${RESET}"; exit 1; }
  echo -e "${GREEN}✓ Docker and Compose found${RESET}"
}

init_env() {
  if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env from template...${RESET}"
    cp .env.example .env
    # Generate a random JWT secret
    JWT=$(openssl rand -hex 32 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "change-me-$(date +%s)")
    sed -i "s/change-this-to-a-long-random-string-in-production/$JWT/g" .env
    echo -e "${GREEN}✓ .env created — edit passwords before production use!${RESET}"
  else
    echo -e "${GREEN}✓ .env exists${RESET}"
  fi
}

init_dirs() {
  echo -e "${YELLOW}Creating required directories...${RESET}"
  mkdir -p configs/wazuh/certs configs/nginx/ssl
  # Placeholder self-signed cert for nginx (replace with real cert in production)
  if [ ! -f configs/nginx/ssl/cert.pem ]; then
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout configs/nginx/ssl/key.pem \
      -out configs/nginx/ssl/cert.pem \
      -subj "/CN=soc-portal/O=SOC/C=CM" 2>/dev/null || true
    echo -e "${GREEN}✓ Self-signed TLS certificate generated${RESET}"
  fi
  echo -e "${GREEN}✓ Directories ready${RESET}"
}

cmd_start() {
  banner
  check_deps
  init_env
  init_dirs

  echo -e "${YELLOW}Starting SOC Platform...${RESET}"
  echo -e "${CYAN}This may take several minutes on first run (downloading images).${RESET}"
  echo ""

  $COMPOSE up -d --build

  echo ""
  echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${RESET}"
  echo -e "${GREEN}${BOLD}║            SOC PORTAL IS STARTING UP                ║${RESET}"
  echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "  ${BOLD}SOC Portal:${RESET}      ${CYAN}http://localhost${RESET}         (main dashboard)"
  echo -e "  ${BOLD}Grafana:${RESET}         ${CYAN}http://localhost/grafana${RESET}  (dashboards)"
  echo -e "  ${BOLD}Wazuh UI:${RESET}        ${CYAN}http://localhost/wazuh${RESET}    (SIEM console)"
  echo -e "  ${BOLD}OpenVAS:${RESET}         ${CYAN}http://localhost/openvas${RESET}  (vuln scanner)"
  echo ""
  echo -e "  ${BOLD}Default Login:${RESET}   admin / SocPortal1!"
  echo ""
  echo -e "${YELLOW}NOTE: Wazuh indexer takes ~2 min to become healthy.${RESET}"
  echo -e "${YELLOW}NOTE: Ollama will pull the LLM model on first start (~2 GB).${RESET}"
  echo -e "${YELLOW}NOTE: OpenVAS NVT sync takes 10–20 min on first run.${RESET}"
  echo ""
  echo -e "  Run ${CYAN}./setup.sh logs${RESET} to watch startup logs."
}

cmd_stop() {
  echo -e "${YELLOW}Stopping SOC Platform...${RESET}"
  $COMPOSE down
  echo -e "${GREEN}✓ Stopped${RESET}"
}

cmd_restart() {
  cmd_stop
  sleep 2
  cmd_start
}

cmd_status() {
  echo -e "${BOLD}SOC Platform — Container Status${RESET}"
  echo ""
  $COMPOSE ps
}

cmd_logs() {
  SERVICE=${2:-""}
  if [ -z "$SERVICE" ]; then
    $COMPOSE logs -f --tail=50
  else
    $COMPOSE logs -f --tail=100 "$SERVICE"
  fi
}

cmd_pull_model() {
  MODEL=${2:-"llama3.2:3b"}
  echo -e "${YELLOW}Pulling Ollama model: ${MODEL}${RESET}"
  echo -e "${CYAN}Available free models:${RESET}"
  echo "  llama3.2:3b   — Fast, 2 GB, good for reports"
  echo "  llama3.1:8b   — Better quality, 5 GB"
  echo "  mistral:7b    — Excellent balance, 4 GB"
  echo "  phi3:mini     — Very fast, 2 GB"
  echo ""
  docker exec soc-ollama ollama pull "$MODEL"
  echo -e "${GREEN}✓ Model ${MODEL} ready${RESET}"
  # Update .env
  sed -i "s/^OLLAMA_MODEL=.*/OLLAMA_MODEL=$MODEL/" .env
  echo -e "${YELLOW}Updated OLLAMA_MODEL in .env. Restart portal: ./setup.sh restart${RESET}"
}

cmd_update() {
  echo -e "${YELLOW}Pulling latest images...${RESET}"
  $COMPOSE pull
  $COMPOSE up -d --build
  echo -e "${GREEN}✓ Updated${RESET}"
}

cmd_backup() {
  DATE=$(date +%Y%m%d_%H%M%S)
  BACKUP="backup_${DATE}.tar.gz"
  echo -e "${YELLOW}Backing up SOC data to ${BACKUP}...${RESET}"
  tar czf "$BACKUP" \
    configs/ .env \
    --exclude='configs/nginx/ssl' 2>/dev/null || true
  echo -e "${GREEN}✓ Backup saved: ${BACKUP}${RESET}"
}

# ── Main ────────────────────────────────────────────────────────
case "${1:-start}" in
  start)        cmd_start   ;;
  stop)         cmd_stop    ;;
  restart)      cmd_restart ;;
  status)       cmd_status  ;;
  logs)         cmd_logs "$@" ;;
  pull-model)   cmd_pull_model "$@" ;;
  update)       cmd_update  ;;
  backup)       cmd_backup  ;;
  *)
    echo "Usage: ./setup.sh [start|stop|restart|status|logs [service]|pull-model [model]|update|backup]"
    ;;
esac

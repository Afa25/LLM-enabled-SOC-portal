#!/usr/bin/env bash
set -e

if [ ! -S /var/run/docker.sock ]; then
  echo "ERROR: /var/run/docker.sock not mounted."
  echo "Run this container with:"
  echo "  -v /var/run/docker.sock:/var/run/docker.sock"
  echo "  -v /path/to/soc-portal:/stack"
  exit 1
fi

cd /stack

if [ ! -f .env ]; then
  cp .env.example .env
fi

echo "Starting SOC manager stack..."
docker compose -f /stack/docker-compose.yml up -d --build
echo "Done."
tail -f /dev/null

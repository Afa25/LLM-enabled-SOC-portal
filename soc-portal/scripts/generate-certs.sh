#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  generate-certs.sh — Generate self-signed TLS certificates for Wazuh
#  Run once before first docker compose up
#  Usage: bash scripts/generate-certs.sh
# ═══════════════════════════════════════════════════════════════════
set -e

CERT_DIR="configs/wazuh/certs"
mkdir -p "$CERT_DIR"

echo "Generating self-signed TLS certificates for Wazuh..."

# ── Root CA ───────────────────────────────────────────────────────
openssl genrsa -out "$CERT_DIR/root-ca-key.pem" 2048 2>/dev/null
openssl req -new -x509 -sha256 -key "$CERT_DIR/root-ca-key.pem" \
  -subj "/C=CM/O=SOCPortal/CN=SOC-Root-CA" \
  -out "$CERT_DIR/root-ca.pem" -days 3650 2>/dev/null
echo "  ✓ Root CA"

# ── Wazuh Indexer cert ────────────────────────────────────────────
openssl genrsa -out "$CERT_DIR/indexer-key.pem" 2048 2>/dev/null
openssl req -new -key "$CERT_DIR/indexer-key.pem" \
  -subj "/C=CM/O=SOCPortal/CN=wazuh-indexer" \
  -out "$CERT_DIR/indexer.csr" 2>/dev/null
openssl x509 -req -in "$CERT_DIR/indexer.csr" \
  -CA "$CERT_DIR/root-ca.pem" -CAkey "$CERT_DIR/root-ca-key.pem" \
  -CAcreateserial -out "$CERT_DIR/indexer.pem" -days 3650 -sha256 2>/dev/null
echo "  ✓ Wazuh Indexer"

# ── Wazuh Manager / Filebeat cert ────────────────────────────────
openssl genrsa -out "$CERT_DIR/filebeat-key.pem" 2048 2>/dev/null
openssl req -new -key "$CERT_DIR/filebeat-key.pem" \
  -subj "/C=CM/O=SOCPortal/CN=wazuh-manager" \
  -out "$CERT_DIR/filebeat.csr" 2>/dev/null
openssl x509 -req -in "$CERT_DIR/filebeat.csr" \
  -CA "$CERT_DIR/root-ca.pem" -CAkey "$CERT_DIR/root-ca-key.pem" \
  -CAcreateserial -out "$CERT_DIR/filebeat.pem" -days 3650 -sha256 2>/dev/null
echo "  ✓ Wazuh Manager (Filebeat)"

# ── Wazuh Dashboard cert ──────────────────────────────────────────
openssl genrsa -out "$CERT_DIR/dashboard-key.pem" 2048 2>/dev/null
openssl req -new -key "$CERT_DIR/dashboard-key.pem" \
  -subj "/C=CM/O=SOCPortal/CN=wazuh-dashboard" \
  -out "$CERT_DIR/dashboard.csr" 2>/dev/null
openssl x509 -req -in "$CERT_DIR/dashboard.csr" \
  -CA "$CERT_DIR/root-ca.pem" -CAkey "$CERT_DIR/root-ca-key.pem" \
  -CAcreateserial -out "$CERT_DIR/dashboard.pem" -days 3650 -sha256 2>/dev/null
echo "  ✓ Wazuh Dashboard"

# ── Admin cert (for indexer security init) ───────────────────────
openssl genrsa -out "$CERT_DIR/admin-key.pem" 2048 2>/dev/null
openssl req -new -key "$CERT_DIR/admin-key.pem" \
  -subj "/C=CM/O=SOCPortal/CN=admin" \
  -out "$CERT_DIR/admin.csr" 2>/dev/null
openssl x509 -req -in "$CERT_DIR/admin.csr" \
  -CA "$CERT_DIR/root-ca.pem" -CAkey "$CERT_DIR/root-ca-key.pem" \
  -CAcreateserial -out "$CERT_DIR/admin.pem" -days 3650 -sha256 2>/dev/null
echo "  ✓ Admin cert"

# Cleanup CSR files
rm -f "$CERT_DIR"/*.csr "$CERT_DIR"/*.srl

chmod 600 "$CERT_DIR"/*-key.pem
echo ""
echo "All certificates saved to $CERT_DIR/"
echo "Ready to run: ./setup.sh start"

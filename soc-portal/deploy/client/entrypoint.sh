#!/usr/bin/env bash
set -e

WAZUH_MANAGER="${WAZUH_MANAGER:-127.0.0.1}"
WAZUH_AGENT_NAME="${WAZUH_AGENT_NAME:-endpoint-01}"
WAZUH_REGISTRATION_SERVER="${WAZUH_REGISTRATION_SERVER:-$WAZUH_MANAGER}"
WAZUH_REGISTRATION_PASSWORD="${WAZUH_REGISTRATION_PASSWORD:-}"

SNMP_COMMUNITY="${SNMP_COMMUNITY:-public}"
SNMP_ALLOWED="${SNMP_ALLOWED:-0.0.0.0/0}"

# Update Wazuh agent config
CONF="/var/ossec/etc/ossec.conf"
if grep -q "<address>" "$CONF"; then
  sed -i "s|<address>.*</address>|<address>${WAZUH_MANAGER}</address>|" "$CONF"
else
  cat >> "$CONF" <<EOF
  <client>
    <server>
      <address>${WAZUH_MANAGER}</address>
      <port>1514</port>
      <protocol>tcp</protocol>
    </server>
  </client>
EOF
fi

if grep -q "<agent_name>" "$CONF"; then
  sed -i "s|<agent_name>.*</agent_name>|<agent_name>${WAZUH_AGENT_NAME}</agent_name>|" "$CONF"
else
  cat >> "$CONF" <<EOF
  <agent_name>${WAZUH_AGENT_NAME}</agent_name>
EOF
fi

# Configure snmpd community and allowed manager
sed -i "s/^rocommunity .*/rocommunity ${SNMP_COMMUNITY} ${SNMP_ALLOWED}/" /etc/snmp/snmpd.conf

# Optional enrollment (if authd password provided)
if [ -n "$WAZUH_REGISTRATION_PASSWORD" ]; then
  /var/ossec/bin/agent-auth -m "$WAZUH_REGISTRATION_SERVER" -A "$WAZUH_AGENT_NAME" -P "$WAZUH_REGISTRATION_PASSWORD" || true
fi

# Start services
service wazuh-agent start

# Run snmpd in foreground
exec /usr/sbin/snmpd -f -Lo

#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  enroll-agent.sh — Print Wazuh agent install commands for any OS
#  Run on the SOC host, copy the output command to your endpoint
#  Usage: bash scripts/enroll-agent.sh [linux|windows|macos]
# ═══════════════════════════════════════════════════════════════════

MANAGER_IP="${MANAGER_IP:-$(hostname -I | awk '{print $1}')}"
WAZUH_VERSION="4.7.3"

OS="${1:-linux}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " Wazuh Agent Enrollment — ${OS^^}"
echo " Manager IP: ${MANAGER_IP}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

case "$OS" in
  linux|ubuntu|debian)
    echo "# Run on the target Linux endpoint:"
    echo ""
    echo "curl -s https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --no-default-keyring --keyring gnupg-ring:/usr/share/keyrings/wazuh.gpg --import && chmod 644 /usr/share/keyrings/wazuh.gpg"
    echo "echo \"deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main\" | tee /etc/apt/sources.list.d/wazuh.list"
    echo "apt-get update && apt-get install -y wazuh-agent snmpd"
    echo ""
    echo "# Configure and start:"
    echo "WAZUH_MANAGER='${MANAGER_IP}' WAZUH_AGENT_NAME='linux-endpoint' dpkg-reconfigure wazuh-agent"
    echo "systemctl daemon-reload && systemctl enable wazuh-agent && systemctl start wazuh-agent"
    echo ""
    echo "# Enable SNMP (change community string in /etc/snmp/snmpd.conf):"
    echo "sed -i 's/^rocommunity .*/rocommunity public 0.0.0.0\\/0/' /etc/snmp/snmpd.conf"
    echo "systemctl enable snmpd && systemctl restart snmpd"
    ;;
  windows)
    echo "# Run in PowerShell as Administrator on the target Windows endpoint:"
    echo ""
    echo "Invoke-WebRequest -Uri https://packages.wazuh.com/4.x/windows/wazuh-agent-${WAZUH_VERSION}-1.msi -OutFile wazuh-agent.msi"
    echo "msiexec.exe /i wazuh-agent.msi /q WAZUH_MANAGER='${MANAGER_IP}' WAZUH_AGENT_NAME='windows-endpoint' WAZUH_REGISTRATION_SERVER='${MANAGER_IP}'"
    echo "NET START WazuhSvc"
    ;;
  macos)
    echo "# Run on the target macOS endpoint:"
    echo ""
    echo "curl -so wazuh-agent.pkg https://packages.wazuh.com/4.x/macos/wazuh-agent-${WAZUH_VERSION}-1.pkg"
    echo "echo 'WAZUH_MANAGER=\"${MANAGER_IP}\"' > /tmp/wazuh_envs"
    echo "sudo installer -pkg wazuh-agent.pkg -target / -applyChoiceChangesXML /tmp/wazuh_envs"
    echo "sudo /Library/Ossec/bin/wazuh-control start"
    ;;
  *)
    echo "Usage: $0 [linux|windows|macos]"
    ;;
esac

echo ""
echo "After enrollment, verify in the SOC Portal → Agents page."
echo ""

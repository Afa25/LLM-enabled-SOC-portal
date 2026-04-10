FROM ubuntu:22.04

# Prevent interactive prompts during build
ENV DEBIAN_FRONTEND=noninteractive

# Consolidate all installations and cleanups into a single layer to minimize image size
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    snmpd && \
    # Setup Wazuh repository
    curl -s https://packages.wazuh.com/key/GPG-KEY-WAZUH | gpg --dearmor -o /usr/share/keyrings/wazuh.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/wazuh.gpg] https://packages.wazuh.com/4.x/apt/ stable main" \
    > /etc/apt/sources.list.d/wazuh.list && \
    # Install Wazuh agent
    apt-get update && \
    apt-get install -y --no-install-recommends wazuh-agent && \
    # Thorough cleanup of package lists and temporary files
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Copy configuration and entrypoint
COPY entrypoint.sh /entrypoint.sh
COPY snmpd.conf /etc/snmp/snmpd.conf

# Set permissions
RUN chmod +x /entrypoint.sh

# SNMP port
EXPOSE 161/udp

ENTRYPOINT ["/entrypoint.sh"]

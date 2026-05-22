# ═══════════════════════════════════════════════════════
#  Zeek Site Configuration — SOC Portal
# ═══════════════════════════════════════════════════════

@load base/frameworks/notice
@load base/protocols/conn
@load base/protocols/dns
@load base/protocols/http
@load base/protocols/ssl
@load base/protocols/ssh
@load base/protocols/ftp
@load base/protocols/smtp
@load base/files/hash
@load policy/frameworks/intel/seen
@load policy/protocols/conn/known-hosts
@load policy/protocols/conn/known-services
@load policy/protocols/ssl/validate-certs
@load policy/protocols/ssh/detect-bruteforcing

# Log in JSON format (for Wazuh/Filebeat ingestion)
@load tuning/json-logs

# Enable file extraction prefix
redef FileExtract::prefix = "/tmp/zeek_files/";

# DNS: log all queries including failed resolutions
redef DNS::max_pending_msgs = 50000;

# Detect SSH brute force
redef SSH::password_guesses_limit = 30;

# High-value notice generation
hook Notice::policy(n: Notice::Info) {
    add n$actions[Notice::ACTION_LOG];
}

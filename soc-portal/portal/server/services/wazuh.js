const https  = require('https');
const fetch  = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const WAZUH_URL  = process.env.WAZUH_MANAGER_URL  || 'https://localhost:55000';
const WAZUH_USER = process.env.WAZUH_USER          || 'wazuh-wui';
const WAZUH_PASS = process.env.WAZUH_PASS          || 'SecurePassword1!';
const IDX_URL    = process.env.WAZUH_INDEXER_URL   || 'https://localhost:9200';
const IDX_USER   = process.env.WAZUH_INDEXER_USER  || 'admin';
const IDX_PASS   = process.env.WAZUH_INDEXER_PASS  || 'SecurePassword1!';

// Ignore self-signed certs inside Docker
const agent = new https.Agent({ rejectUnauthorized: false });

let _token = null;
let _tokenExp = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExp) return _token;
  const creds = Buffer.from(`${WAZUH_USER}:${WAZUH_PASS}`).toString('base64');
  const res   = await fetch(`${WAZUH_URL}/security/user/authenticate`, {
    method: 'GET',
    headers: { Authorization: `Basic ${creds}` },
    agent
  });
  const data = await res.json();
  _token    = data?.data?.token;
  _tokenExp = Date.now() + 14 * 60 * 1000; // 14 min (token valid 15 min)
  return _token;
}

async function wazuhGet(path) {
  const tok = await getToken();
  const res = await fetch(`${WAZUH_URL}${path}`, {
    headers: { Authorization: `Bearer ${tok}` },
    agent
  });
  return res.json();
}

async function indexerQuery(index, body) {
  const creds = Buffer.from(`${IDX_USER}:${IDX_PASS}`).toString('base64');
  const res = await fetch(`${IDX_URL}/${index}/_search`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    agent
  });
  return res.json();
}

// ── Public API ────────────────────────────────────────────────

async function getAgents() {
  const data = await wazuhGet('/agents?limit=500&select=id,name,ip,status,os,lastKeepAlive,version');
  return data?.data?.affected_items || [];
}

async function getManagerInfo() {
  const data = await wazuhGet('/manager/info');
  return data?.data || {};
}

async function getAlertsSummary(hoursBack = 24) {
  const from = new Date(Date.now() - hoursBack * 3600_000).toISOString();
  const body = {
    size: 0,
    query: { range: { timestamp: { gte: from } } },
    aggs: {
      by_level: {
        terms: { field: 'rule.level', size: 16 }
      },
      by_group: {
        terms: { field: 'rule.groups', size: 20 }
      },
      by_agent: {
        terms: { field: 'agent.name', size: 10 }
      },
      over_time: {
        date_histogram: { field: 'timestamp', calendar_interval: hoursBack <= 24 ? '1h' : '1d' }
      }
    }
  };
  const res = await indexerQuery('wazuh-alerts-*', body);
  return {
    total:    res?.hits?.total?.value || 0,
    by_level: res?.aggregations?.by_level?.buckets || [],
    by_group: res?.aggregations?.by_group?.buckets || [],
    by_agent: res?.aggregations?.by_agent?.buckets || [],
    over_time:res?.aggregations?.over_time?.buckets || []
  };
}

async function getAlerts({ limit = 50, level, from, to } = {}) {
  const must = [];
  if (level) must.push({ term: { 'rule.level': level } });
  if (from || to) {
    const range = {};
    if (from) range.gte = from;
    if (to)   range.lte = to;
    must.push({ range: { timestamp: range } });
  }
  const body = {
    size: limit,
    sort: [{ timestamp: { order: 'desc' } }],
    query: must.length ? { bool: { must } } : { match_all: {} },
    _source: ['timestamp','rule.id','rule.description','rule.level',
               'rule.mitre','agent.name','agent.ip','data']
  };
  const res = await indexerQuery('wazuh-alerts-*', body);
  return res?.hits?.hits?.map(h => h._source) || [];
}

async function getAlertCountByRange(startISO, endISO) {
  const body = {
    size: 0,
    query: { range: { timestamp: { gte: startISO, lte: endISO } } },
    aggs: {
      by_level:  { terms: { field: 'rule.level',  size: 16 } },
      by_group:  { terms: { field: 'rule.groups', size: 20 } },
      by_agent:  { terms: { field: 'agent.name',  size: 10 } },
      by_mitre:  { terms: { field: 'rule.mitre.technique', size: 15 } },
      top_rules: { terms: { field: 'rule.description', size: 10 } },
      over_time: { date_histogram: { field: 'timestamp', calendar_interval: '1d' } }
    }
  };
  const res = await indexerQuery('wazuh-alerts-*', body);
  return {
    total:     res?.hits?.total?.value || 0,
    by_level:  res?.aggregations?.by_level?.buckets  || [],
    by_group:  res?.aggregations?.by_group?.buckets  || [],
    by_agent:  res?.aggregations?.by_agent?.buckets  || [],
    by_mitre:  res?.aggregations?.by_mitre?.buckets  || [],
    top_rules: res?.aggregations?.top_rules?.buckets || [],
    over_time: res?.aggregations?.over_time?.buckets || []
  };
}

module.exports = { getAgents, getManagerInfo, getAlertsSummary, getAlerts, getAlertCountByRange };

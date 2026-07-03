const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const OLLAMA_URL  = process.env.OLLAMA_URL  || 'http://ollama:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

async function embed(text) {
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model: EMBED_MODEL, prompt: String(text).slice(0, 2000) }),
    signal:  AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.embedding)) throw new Error('No embedding in response');
  return data.embedding;
}

module.exports = { embed, EMBED_MODEL };

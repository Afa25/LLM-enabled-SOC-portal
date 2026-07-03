const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const CHROMA_URL = process.env.CHROMADB_URL || 'http://chromadb:8000';
const COLLECTION = 'soc_events';

// Cache the collection UUID — ChromaDB 0.5.x requires UUID in path, not name
let collectionId = null;

async function ensureCollection() {
  if (collectionId) return collectionId;

  // Try to GET existing collection first
  const get = await fetch(`${CHROMA_URL}/api/v1/collections/${COLLECTION}`, {
    signal: AbortSignal.timeout(10_000),
  });

  if (get.ok) {
    const data = await get.json();
    collectionId = data.id;
    return collectionId;
  }

  // Create if it doesn't exist
  const create = await fetch(`${CHROMA_URL}/api/v1/collections`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name: COLLECTION, metadata: { 'hnsw:space': 'cosine' } }),
    signal:  AbortSignal.timeout(10_000),
  });

  if (!create.ok && create.status !== 409) {
    throw new Error(`ChromaDB create collection failed: ${create.status}`);
  }

  // If 409 race condition, fetch again
  const retry = await fetch(`${CHROMA_URL}/api/v1/collections/${COLLECTION}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!retry.ok) throw new Error(`ChromaDB get collection failed: ${retry.status}`);
  const data = await retry.json();
  collectionId = data.id;
  return collectionId;
}

async function upsertDocuments(ids, embeddings, documents, metadatas) {
  if (!ids.length) return;
  const cid = await ensureCollection();
  const res = await fetch(`${CHROMA_URL}/api/v1/collections/${cid}/upsert`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ids, embeddings, documents, metadatas }),
    signal:  AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ChromaDB upsert failed: ${res.status}`);
}

async function queryDocuments(embedding, nResults = 8, sourceFilter = null) {
  const cid  = await ensureCollection();
  const body = { query_embeddings: [embedding], n_results: nResults };
  if (sourceFilter) body.where = { source: { '$eq': sourceFilter } };

  const res = await fetch(`${CHROMA_URL}/api/v1/collections/${cid}/query`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ChromaDB query failed: ${res.status}`);
  const data = await res.json();

  const docs  = data.documents?.[0] || [];
  const metas = data.metadatas?.[0] || [];
  return docs.map((text, i) => ({ text, meta: metas[i] || {} }));
}

module.exports = { ensureCollection, upsertDocuments, queryDocuments };

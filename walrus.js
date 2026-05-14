// walrus.js — Walrus mainnet HTTP client with publisher/aggregator fallback chain.
// All endpoints below are MAINNET. No testnet.

// HTTP PUT publishers (mainnet). Mysten's hostname `publisher.walrus-mainnet.walrus.space` does
// not resolve in public DNS (NXDOMAIN as of 2026-05); use community publishers from Walrus
// operator listings instead (e.g. https://docs.wal.app/operators.json).
const PUBLISHERS = [
  'https://walrus-mainnet-publisher-1.staketab.org',
  'https://publisher.walrus-mainnet.h2o-nodes.com',
];

/** localStorage: base URL of Walrus HTTP publisher on this machine (no trailing slash). */
export const WALFORMS_LOCAL_PUBLISHER_KEY = 'walforms.localPublisherBaseUrl';

export function getLocalPublisherBaseUrl() {
  try {
    const raw = localStorage.getItem(WALFORMS_LOCAL_PUBLISHER_KEY)?.trim();
    if (!raw) return null;
    return raw.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Persist local publisher base (e.g. http://127.0.0.1:31416). Pass empty string to clear. */
export function setLocalPublisherBaseUrl(url) {
  const t = String(url ?? '').trim().replace(/\/+$/, '');
  try {
    if (!t) {
      localStorage.removeItem(WALFORMS_LOCAL_PUBLISHER_KEY);
      return;
    }
    new URL(t);
    localStorage.setItem(WALFORMS_LOCAL_PUBLISHER_KEY, t);
  } catch {
    throw new TypeError('Invalid publisher base URL.');
  }
}

export function clearLocalPublisherBaseUrl() {
  try {
    localStorage.removeItem(WALFORMS_LOCAL_PUBLISHER_KEY);
  } catch { /* ignore */ }
}

/** True when Walrus uploads will try your local publisher first. */
export function isLocalPublisherModeActive() {
  return Boolean(getLocalPublisherBaseUrl());
}

/** Publisher bases for PUT /v1/blobs: local first (if configured), then defaults. */
function getUploadPublisherBases() {
  const local = getLocalPublisherBaseUrl();
  if (!local) return [...PUBLISHERS];
  const dedup = PUBLISHERS.filter((b) => b !== local);
  return [local, ...dedup];
}

const AGGREGATORS = [
  'https://aggregator.walrus-mainnet.walrus.space',
  'https://wal-aggregator-mainnet.staketab.org',
];

const DB_NAME = 'walrus-upload-queue';
const DB_VERSION = 1;
const STORE_NAME = 'uploads';
let dbPromise = null;
let processingQueue = false;

function normalizeBlobData(data) {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return data;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function serializeBlobData(data) {
  if (typeof data === 'string') {
    return { kind: 'text', payload: data };
  }
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    const bytes = normalizeBlobData(data);
    return { kind: 'binary', payload: bytesToBase64(bytes) };
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    throw new TypeError('Blob instances are not directly queueable. Convert to ArrayBuffer first.');
  }
  throw new TypeError('Unsupported blob data type for upload queue');
}

function deserializeBlobData(serialized) {
  if (serialized.kind === 'text') {
    return serialized.payload;
  }
  if (serialized.kind === 'binary') {
    return base64ToBytes(serialized.payload);
  }
  throw new TypeError('Unsupported queued blob data type');
}

function openQueueDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function getQueueStore(mode = 'readonly') {
  const db = await openQueueDb();
  const tx = db.transaction(STORE_NAME, mode);
  return tx.objectStore(STORE_NAME);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Transient gateway / upstream failures — short retry before trying next publisher. */
const RETRYABLE_UPLOAD_STATUS = new Set([502, 503, 504]);

export async function uploadBlob(data, { epochs = 5, sendObjectTo = null } = {}) {
  const body = normalizeBlobData(data);
  const errors = [];

  for (const base of getUploadPublisherBases()) {
    const url = new URL(`${base}/v1/blobs`);
    url.searchParams.set('epochs', epochs);
    if (sendObjectTo) url.searchParams.set('send_object_to', sendObjectTo);

    try {
      let res = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await fetch(url, {
          method: 'PUT',
          body,
        });
        if (res.ok) break;
        const retryable = RETRYABLE_UPLOAD_STATUS.has(res.status);
        if (!retryable || attempt === 2) break;
        await sleep(350 * 2 ** attempt);
      }

      if (!res.ok) {
        errors.push(`${base}: HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      const blobId =
        json.newlyCreated?.blobObject?.blobId ||
        json.newlyCreated?.blobObject?.blob_id ||
        json.newlyCreated?.blob_id ||
        json.alreadyCertified?.blobId ||
        json.alreadyCertified?.blob_id ||
        json.blobId ||
        json.blob_id;

      if (!blobId) {
        errors.push(`${base}: no blobId in response (${JSON.stringify(json).slice(0, 180)})`);
        continue;
      }

      return { blobId, response: json, publisher: base };
    } catch (error) {
      errors.push(`${base}: ${error.message}`);
    }
  }

  throw new WalrusUploadError('All publishers failed', errors);
}

export async function fetchBlob(blobId, { asJson = false } = {}) {
  const errors = [];

  for (const base of AGGREGATORS) {
    try {
      const res = await fetch(`${base}/v1/blobs/${blobId}`, { cache: 'no-store' });
      if (!res.ok) {
        errors.push(`${base}: HTTP ${res.status}`);
        continue;
      }
      return asJson ? await res.json() : await res.arrayBuffer();
    } catch (error) {
      errors.push(`${base}: ${error.message}`);
    }
  }

  throw new WalrusFetchError(`Blob ${blobId} not found`, errors);
}

export async function queueUpload(data, options = {}) {
  const id = crypto.randomUUID();
  const serialized = serializeBlobData(data);
  const item = {
    id,
    createdAt: Date.now(),
    data: serialized,
    options,
    attempts: 0,
    status: 'pending',
    lastError: null,
  };
  const store = await getQueueStore('readwrite');
  store.put(item);
  return id;
}

export async function getRetryQueue() {
  const store = await getQueueStore('readonly');
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.createdAt - b.createdAt));
    request.onerror = () => reject(request.error);
  });
}

export async function clearRetryQueue() {
  const store = await getQueueStore('readwrite');
  return new Promise((resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function deleteQueueItem(id) {
  const store = await getQueueStore('readwrite');
  return new Promise((resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function updateQueueItem(item) {
  const store = await getQueueStore('readwrite');
  return new Promise((resolve, reject) => {
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function processRetryQueue() {
  if (processingQueue) return [];
  processingQueue = true;

  const queued = await getRetryQueue();
  const snapshot = [];

  for (const item of queued) {
    if (item.status !== 'pending' && item.status !== 'failed') {
      snapshot.push(item);
      continue;
    }

    item.attempts += 1;
    item.status = 'processing';
    await updateQueueItem(item);

    try {
      const data = deserializeBlobData(item.data);
      const result = await uploadBlob(data, item.options);
      item.status = 'finished';
      item.result = result;
      await deleteQueueItem(item.id);
      snapshot.push({ ...item, result });
    } catch (error) {
      item.status = 'failed';
      item.lastError = error instanceof Error ? error.message : String(error);
      await updateQueueItem(item);
      snapshot.push(item);
    }
  }

  processingQueue = false;
  return snapshot;
}

export class WalrusUploadError extends Error {
  constructor(msg, attempts) {
    super(msg);
    this.attempts = attempts;
  }
}

export class WalrusFetchError extends Error {
  constructor(msg, attempts) {
    super(msg);
    this.attempts = attempts;
  }
}

export function curlFallback(epochs = 5, fileName = 'YOUR_FILE', publisherIndex = 0) {
  const bases = getUploadPublisherBases();
  const base = bases[publisherIndex];
  if (!base) return '';
  const encoded = encodeURI(`${base}/v1/blobs?epochs=${epochs}`);
  return `curl -X PUT "${encoded}" --upload-file ${fileName}`;
}

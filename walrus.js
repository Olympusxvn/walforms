// walrus.js — Walrus mainnet HTTP client with publisher/aggregator fallback chain.
// All endpoints below are MAINNET. No testnet.

const PUBLISHERS = [
  'https://publisher.walrus.space',
  'https://publisher.walrus-mainnet.walrus.space',
  'https://walrus-mainnet-publisher-1.staketab.org',
];

const AGGREGATORS = [
  'https://aggregator.walrus.space',
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

export async function uploadBlob(data, { epochs = 5, sendObjectTo = null } = {}) {
  const body = normalizeBlobData(data);
  const errors = [];

  for (const base of PUBLISHERS) {
    const url = new URL(`${base}/v1/blobs`);
    url.searchParams.set('epochs', epochs);
    if (sendObjectTo) url.searchParams.set('send_object_to', sendObjectTo);

    try {
      const res = await fetch(url, {
        method: 'PUT',
        body,
      });

      if (!res.ok) {
        errors.push(`${base}: HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      const blobId =
        json.newlyCreated?.blobObject?.blobId ||
        json.alreadyCertified?.blobId;

      if (!blobId) {
        errors.push(`${base}: no blobId in response`);
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

export function curlFallback(epochs = 5, fileName = 'YOUR_FILE') {
  const encoded = encodeURI(`${PUBLISHERS[0]}/v1/blobs?epochs=${epochs}`);
  return `curl -X PUT "${encoded}" --upload-file ${fileName}`;
}

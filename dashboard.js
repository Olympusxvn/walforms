// dashboard.js — admin view: auth check, submissions list, filter/sort, notes,
// priority/flag (IndexedDB), CSV export, seal form TX.

import { fetchBlob } from './walrus.js';
import { sha256, bytesToHex, merkleRoot } from './crypto.js';
import { getWalForm, getSubmissionEvents, txSealForm, isWalletConnected, getConnectedAddress, getAdminAddresses } from './sui.js';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const gateEl        = document.getElementById('dash-gate');
const authWall      = document.getElementById('auth-wall');
const authMsg       = document.getElementById('auth-message');
const dashEl        = document.getElementById('dashboard');
const titleEl       = document.getElementById('dash-form-title');
const metaEl        = document.getElementById('dash-form-meta');
const accessBadgeEl = document.getElementById('dash-access-badge');
const refreshBtn    = document.getElementById('refresh-btn');
const syncPillEl    = document.getElementById('dash-sync-pill');
const lastSyncEl    = document.getElementById('dash-last-sync');
const sealedBanner  = document.getElementById('sealed-banner');
const sealedMeta    = document.getElementById('sealed-meta');
const sealBtn       = document.getElementById('seal-btn');
const sealSection   = document.getElementById('seal-section');
const sealConfirmBtn= document.getElementById('seal-confirm-btn');
const sealProgress  = document.getElementById('seal-progress');
const csvBtn        = document.getElementById('csv-export-btn');
const verifyLink    = document.getElementById('verify-link');
const subListEl     = document.getElementById('sub-list');
const subEmptyEl    = document.getElementById('sub-empty');
const filterSearch  = document.getElementById('filter-search');
const filterSort    = document.getElementById('filter-sort');
const filterFlagged = document.getElementById('filter-flagged');
const filterPriority= document.getElementById('filter-priority');
const filterCount   = document.getElementById('filter-count');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let walForm   = null;
let events    = [];          // raw SubmissionRecorded events
let blobs     = {};          // blobId -> parsed JSON (lazy loaded)
let localMeta = {};          // blobId -> { note, flagged, priority }
let adminAddresses = [];
let refreshIntervalId = null;

const formId = new URLSearchParams(location.search).get('id');

// ---------------------------------------------------------------------------
// IndexedDB for local metadata (notes, flags, priority)
// ---------------------------------------------------------------------------
let db = null;

async function openDB() {
  if (db) return db;
  return new Promise((res, rej) => {
    const req = indexedDB.open('walforms-dashboard', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('meta', { keyPath: 'blobId' });
    };
    req.onsuccess  = e => { db = e.target.result; res(db); };
    req.onerror    = e => rej(e.target.error);
  });
}

async function saveMeta(blobId, patch) {
  const store = await openDB();
  const current = localMeta[blobId] ?? { blobId, note: '', flagged: false, priority: false };
  const updated = { ...current, ...patch, blobId };
  localMeta[blobId] = updated;
  return new Promise((res, rej) => {
    const tx = store.transaction('meta', 'readwrite');
    const req = tx.objectStore('meta').put(updated);
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}

async function loadAllMeta() {
  const store = await openDB();
  return new Promise((res, rej) => {
    const tx = store.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').getAll();
    req.onsuccess = e => {
      localMeta = {};
      for (const row of e.target.result) localMeta[row.blobId] = row;
      res();
    };
    req.onerror = e => rej(e.target.error);
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function init() {
  if (!formId) {
    authMsg.innerHTML = 'No form ID in URL. Use <code>dashboard.html?id=&lt;SUI_OBJECT_ID&gt;</code>.';
    return;
  }

  // Check wallet connection — poll until connected or timeout
  if (!isWalletConnected()) {
    authMsg.innerHTML = `Connect your wallet to access the admin dashboard.<br>
      <span style="font-size:var(--text-sm);color:var(--color-muted)">Only the form creator or an admin wallet can view this page.</span>`;
    // Re-check every second until connected (app.js handles the connect button)
    const interval = setInterval(async () => {
      if (isWalletConnected()) {
        clearInterval(interval);
        await loadDashboard();
      }
    }, 800);
    return;
  }

  await loadDashboard();
}

async function loadDashboard() {
  authMsg.innerHTML = '<span class="spinner"></span> Loading form…';

  // Fetch WalForm
  try {
    walForm = await getWalForm(formId);
  } catch (e) {
    authMsg.textContent = `Could not load form: ${e.message}`;
    return;
  }

  // Auth check — only creator can view
  const creator = walForm.creator?.toLowerCase();
  const viewer  = getConnectedAddress()?.toLowerCase();
  try {
    adminAddresses = await getAdminAddresses();
  } catch {
    adminAddresses = [];
  }
  const isAdmin = Boolean(viewer && adminAddresses.includes(viewer));
  const isCreator = Boolean(viewer && creator === viewer);
  const canView = Boolean(viewer && (isCreator || isAdmin));
  if (!canView) {
    authMsg.innerHTML = `
      <strong>Not authorized</strong><br>
      <span style="font-size:var(--text-sm);color:var(--color-muted)">
        Only the form creator (<code>${shortAddr(walForm.creator)}</code>) or an admin wallet can view this dashboard.
        You are connected as <code>${shortAddr(getConnectedAddress())}</code>.
      </span>`;
    return;
  }

  // Auth passed — show dashboard
  gateEl.hidden = true;
  dashEl.hidden = false;

  // Fill header
  titleEl.textContent = walForm.title || 'Untitled form';
  metaEl.textContent  = `${walForm.submissionCount} submission${walForm.submissionCount !== 1 ? 's' : ''} · Created by ${shortAddr(walForm.creator)}`;
  if (accessBadgeEl) {
    if (isCreator) {
      accessBadgeEl.hidden = false;
      accessBadgeEl.dataset.access = 'creator';
      accessBadgeEl.textContent = 'Access as Creator';
    } else if (isAdmin) {
      accessBadgeEl.hidden = false;
      accessBadgeEl.dataset.access = 'admin';
      accessBadgeEl.textContent = 'Access as Admin';
    } else {
      accessBadgeEl.hidden = true;
      accessBadgeEl.textContent = '';
      delete accessBadgeEl.dataset.access;
    }
  }

  // Sealed state
  if (walForm.isSealed) {
    sealedBanner.hidden = false;
    sealBtn.disabled = true;
    sealBtn.textContent = 'Sealed';
    sealConfirmBtn.disabled = true;
    const sealDate = walForm.sealedAtMs ? new Date(walForm.sealedAtMs).toLocaleString() : '';
    if (sealedMeta) sealedMeta.textContent = sealDate ? `Sealed at ${sealDate}` : '';
  }

  // Verify link
  if (verifyLink) verifyLink.href = `verify.html?id=${formId}`;

  // Load local metadata from IndexedDB
  try { await loadAllMeta(); } catch { /* non-fatal */ }

  await refreshSubmissions({ silent: false });
  attachFilterEvents();
  attachSealEvents();
  attachRefreshEvents();
  startAutoRefresh();
  csvBtn?.addEventListener('click', exportCSV);
}

function updateLastSync() {
  const now = new Date();
  if (lastSyncEl) lastSyncEl.textContent = `Last sync: ${now.toLocaleTimeString()}`;
  if (syncPillEl) syncPillEl.hidden = false;
}

function updateHeaderMetaLiveCount() {
  if (!metaEl || !walForm) return;
  const count = events.length;
  metaEl.textContent = `${count} submission${count !== 1 ? 's' : ''} · Created by ${shortAddr(walForm.creator)}`;
}

async function refreshSubmissions({ silent = true } = {}) {
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing…';
  }
  try {
    events = await getSubmissionEvents(formId);
    updateHeaderMetaLiveCount();
    renderList();
    updateLastSync();
    if (!silent) {
      window.walformsApp?.showStatusMessage(`Dashboard synced (${events.length} submission${events.length !== 1 ? 's' : ''}).`, 'info');
    }
  } catch (e) {
    if (!silent) window.walformsApp?.showStatusMessage(`Could not refresh submissions: ${e.message}`, 'error');
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh';
    }
  }
}

function attachRefreshEvents() {
  refreshBtn?.addEventListener('click', () => refreshSubmissions({ silent: false }));
}

function startAutoRefresh() {
  if (refreshIntervalId) clearInterval(refreshIntervalId);
  refreshIntervalId = setInterval(() => {
    if (document.hidden) return;
    refreshSubmissions({ silent: true });
  }, 30000);
}

window.addEventListener('beforeunload', () => {
  if (refreshIntervalId) clearInterval(refreshIntervalId);
});

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function getFiltered() {
  let list = [...events];

  const q = filterSearch?.value.trim().toLowerCase();
  if (q) {
    list = list.filter(ev => {
      const meta = localMeta[bytesToBlobId(ev.submissionBlobId)];
      return (
        ev.submitter?.toLowerCase().includes(q) ||
        meta?.note?.toLowerCase().includes(q)
      );
    });
  }

  if (filterFlagged?.checked)  list = list.filter(ev => localMeta[bytesToBlobId(ev.submissionBlobId)]?.flagged);
  if (filterPriority?.checked) list = list.filter(ev => localMeta[bytesToBlobId(ev.submissionBlobId)]?.priority);

  const sort = filterSort?.value ?? 'newest';
  list.sort((a, b) => sort === 'oldest'
    ? a.submittedAtMs - b.submittedAtMs
    : b.submittedAtMs - a.submittedAtMs
  );

  return list;
}

function renderList() {
  if (!subListEl) return;
  subListEl.innerHTML = '';

  const list = getFiltered();
  if (filterCount) filterCount.textContent = `${list.length} of ${events.length}`;

  if (list.length === 0) {
    subEmptyEl && (subEmptyEl.hidden = false);
    return;
  }
  subEmptyEl && (subEmptyEl.hidden = true);

  list.forEach(ev => {
    const blobId = bytesToBlobId(ev.submissionBlobId);
    const meta   = localMeta[blobId] ?? { note: '', flagged: false, priority: false };
    const card   = buildSubCard(ev, blobId, meta);
    subListEl.append(card);
  });
}

function buildSubCard(ev, blobId, meta) {
  const card = document.createElement('div');
  card.className = `sub-card${meta.flagged ? ' flagged' : ''}${meta.priority ? ' priority' : ''}`;
  card.setAttribute('role', 'listitem');
  card.dataset.blobId = blobId;

  const timeAgo = relTime(ev.submittedAtMs);
  const absTime = new Date(ev.submittedAtMs).toLocaleString();

  card.innerHTML = `
    <div class="sub-card-head">
      <div class="sub-seq-badge">${ev.sequence + 1}</div>
      <div class="sub-card-meta">
        <div class="sub-card-submitter">${ev.submitter ? shortAddr(ev.submitter) : 'Anonymous'}</div>
        <div class="sub-card-time" title="${absTime}">${timeAgo}</div>
        <div class="sub-card-preview" id="preview-${ev.sequence}">Loading preview…</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:var(--sp-2)">
        <div class="sub-card-chips">
          ${meta.priority ? '<span class="sub-chip sub-chip-priority">Priority</span>' : ''}
          ${meta.flagged  ? '<span class="sub-chip sub-chip-flagged">Flagged</span>'  : ''}
        </div>
        <div class="sub-card-actions">
          <button class="sub-action-btn${meta.priority ? ' active-prio' : ''}" data-action="priority" title="Mark priority">▲ Priority</button>
          <button class="sub-action-btn${meta.flagged  ? ' active-flag' : ''}" data-action="flag"     title="Flag">⚑ Flag</button>
          <a class="sub-action-btn" href="https://suiscan.xyz/mainnet/tx/${ev.txDigest ?? ''}" target="_blank" rel="noopener">Suiscan ↗</a>
        </div>
      </div>
    </div>
    <div class="sub-card-body" id="body-${ev.sequence}">
      <div class="sub-blob-row">Blob: ${blobId} · Hash: ${fieldBytesToHex(ev.submissionHash).slice(0,16)}…</div>
      <div id="answers-${ev.sequence}" class="sub-answers"><span style="color:var(--color-muted);font-size:var(--text-sm)">Loading…</span></div>
      <div class="note-row">
        <label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--color-muted)">Private note</label>
        <textarea placeholder="Add a private note (stored locally, not on-chain)…" data-blob="${blobId}">${esc(meta.note ?? '')}</textarea>
        <p class="note-hint">Notes are private to you and stored in your browser only. They are not on-chain.</p>
      </div>
    </div>
  `;

  // Toggle expand
  card.querySelector('.sub-card-head').addEventListener('click', e => {
    if (e.target.closest('.sub-card-actions, a')) return;
    const body = card.querySelector('.sub-card-body');
    const open = body.classList.toggle('open');
    if (open) loadBlobPreview(ev, blobId, ev.sequence);
  });

  // Priority / flag toggles
  card.querySelector('[data-action="priority"]').addEventListener('click', async e => {
    e.stopPropagation();
    const newVal = !meta.priority;
    meta.priority = newVal;
    await saveMeta(blobId, { priority: newVal });
    renderList();
  });
  card.querySelector('[data-action="flag"]').addEventListener('click', async e => {
    e.stopPropagation();
    const newVal = !meta.flagged;
    meta.flagged = newVal;
    await saveMeta(blobId, { flagged: newVal });
    renderList();
  });

  // Note autosave (debounced)
  let noteTimer;
  card.querySelector('textarea')?.addEventListener('input', e => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => saveMeta(blobId, { note: e.target.value }), 600);
  });

  return card;
}

async function loadBlobPreview(ev, blobId, seq) {
  const answersEl = document.getElementById(`answers-${seq}`);
  const previewEl = document.getElementById(`preview-${seq}`);
  if (!answersEl) return;

  if (blobs[blobId]) {
    renderAnswers(blobs[blobId], answersEl, previewEl);
    return;
  }

  try {
    const bytes  = await fetchBlob(blobId);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    blobs[blobId] = parsed;
    renderAnswers(parsed, answersEl, previewEl);
  } catch {
    answersEl.innerHTML = '<span style="color:var(--color-muted);font-size:var(--text-sm)">Could not fetch submission blob from Walrus.</span>';
    if (previewEl) previewEl.textContent = '(blob unavailable)';
  }
}

function renderAnswers(parsed, answersEl, previewEl) {
  if (!answersEl) return;
  const answers = parsed.answers ?? {};
  const entries = Object.entries(answers);

  if (entries.length === 0) {
    answersEl.innerHTML = '<span style="color:var(--color-muted);font-size:var(--text-sm)">No answers.</span>';
    return;
  }

  answersEl.innerHTML = '';
  entries.forEach(([key, val]) => {
    const dl = document.createElement('dl');
    dl.className = 'sub-answer-row';
    const displayVal = Array.isArray(val) ? val.join(', ') : String(val ?? '—');
    dl.innerHTML = `<dt>${esc(key)}</dt><dd>${esc(displayVal)}</dd>`;
    answersEl.append(dl);
  });

  // Set preview text from first 2 answers
  if (previewEl) {
    const preview = entries.slice(0, 2)
      .map(([, v]) => String(Array.isArray(v) ? v.join(', ') : v ?? '').slice(0, 60))
      .join(' · ');
    previewEl.textContent = preview || '(no answers)';
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
function attachFilterEvents() {
  filterSearch?.addEventListener('input', renderList);
  filterSort?.addEventListener('change', renderList);
  filterFlagged?.addEventListener('change', renderList);
  filterPriority?.addEventListener('change', renderList);
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
async function exportCSV() {
  csvBtn.disabled = true;
  csvBtn.textContent = 'Exporting…';

  // Ensure all blobs are loaded
  for (const ev of getFiltered()) {
    const blobId = bytesToBlobId(ev.submissionBlobId);
    if (!blobs[blobId]) {
      try {
        const bytes = await fetchBlob(blobId);
        blobs[blobId] = JSON.parse(new TextDecoder().decode(bytes));
      } catch { blobs[blobId] = null; }
    }
  }

  const rows = [['#', 'Submitter', 'Submitted at', 'Blob ID', 'Priority', 'Flagged', 'Note', 'Answers']];

  getFiltered().forEach(ev => {
    const blobId = bytesToBlobId(ev.submissionBlobId);
    const meta   = localMeta[blobId] ?? {};
    const blob   = blobs[blobId];
    const answers = blob?.answers
      ? Object.entries(blob.answers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('|') : v}`).join('; ')
      : '(not fetched)';
    rows.push([
      ev.sequence + 1,
      ev.submitter || 'anonymous',
      new Date(ev.submittedAtMs).toISOString(),
      blobId,
      meta.priority ? 'yes' : 'no',
      meta.flagged  ? 'yes' : 'no',
      meta.note ?? '',
      answers,
    ]);
  });

  const csv = rows.map(row =>
    row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `walforms-${formId?.slice(0, 8)}-submissions.csv`;
  a.click();

  csvBtn.disabled = false;
  csvBtn.textContent = 'Export CSV';
}

// ---------------------------------------------------------------------------
// Seal form
// ---------------------------------------------------------------------------
function attachSealEvents() {
  sealBtn?.addEventListener('click', () => {
    sealSection?.scrollIntoView({ behavior: 'smooth' });
  });
  sealConfirmBtn?.addEventListener('click', sealForm);
}

async function sealForm() {
  if (walForm?.isSealed) return;
  sealConfirmBtn.disabled = true;

  const steps = [
    { key: 'merkle',  label: '1. Computing Merkle root over all submissions…' },
    { key: 'sign',    label: '2. Signing Sui seal_form transaction…' },
    { key: 'confirm', label: '3. Waiting for confirmation…' },
  ];
  const statuses = {};

  const renderSealSteps = active => {
    if (!sealProgress) return;
    sealProgress.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'seal-steps';
    steps.forEach(s => {
      const st = statuses[s.key] ?? (s.key === active ? 'active' : 'idle');
      const div = document.createElement('div');
      div.className = 'seal-step';
      div.dataset.status = st;
      const icons = { done: '✓', active: '⋯', error: '✕', idle: '○' };
      const colors = { done: 'var(--color-cyan)', active: 'var(--color-primary)', error: 'var(--color-red)', idle: 'var(--color-muted)' };
      div.innerHTML = `<span style="color:${colors[st]};width:18px;text-align:center">${icons[st]}</span><span>${s.label}</span>`;
      wrap.append(div);
    });
    sealProgress.append(wrap);
  };

  try {
    // Step 1 — Merkle root
    renderSealSteps('merkle');
    const sortedHashes = events.map(ev => fieldBytesToHex(ev.submissionHash));
    const root = await merkleRoot(sortedHashes);
    statuses.merkle = 'done';

    // Step 2 — Sui TX
    renderSealSteps('sign');
    const txResult = await txSealForm(formId, root);
    statuses.sign = 'done';

    // Step 3 — confirm
    renderSealSteps('confirm');
    statuses.confirm = 'done';
    renderSealSteps('confirm');

    // Update UI
    walForm.isSealed = true;
    sealedBanner.hidden = false;
    sealBtn.disabled = true;
    sealBtn.textContent = 'Sealed';
    sealConfirmBtn.disabled = true;
    if (sealedMeta) sealedMeta.textContent = `Sealed at ${new Date().toLocaleString()} · TX: ${txResult?.digest?.slice(0,12)}…`;
    window.walformsApp?.showStatusMessage('Form sealed. Submissions are now locked and publicly verifiable.', 'info');

  } catch (err) {
    statuses[Object.keys(statuses).length === 0 ? 'merkle' : statuses.sign == null ? 'sign' : 'confirm'] = 'error';
    renderSealSteps('error');
    window.walformsApp?.showStatusMessage(`Seal failed: ${err.message}`, 'error');
    sealConfirmBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function bytesToBlobId(field) {
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) {
    const bytes = new Uint8Array(field);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return String(field);
}

function fieldBytesToHex(field) {
  if (typeof field === 'string') return field.startsWith('0x') ? field.slice(2) : field;
  if (Array.isArray(field)) return bytesToHex(new Uint8Array(field));
  return '';
}

function shortAddr(addr) {
  if (!addr) return 'anon';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function relTime(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000)  return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);

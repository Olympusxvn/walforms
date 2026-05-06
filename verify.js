// verify.js — public auditor: fetch form + all submissions, verify hashes, Merkle root.
// No wallet needed. Uses JSZip via CDN for download-all.

import { fetchBlob } from './walrus.js';
import { sha256, bytesToHex, merkleRoot } from './crypto.js';
import { getWalForm, getSubmissionEvents } from './sui.js';

const verifyInput  = document.getElementById('verify-input');
const verifyBtn    = document.getElementById('verify-btn');
const outputEl     = document.getElementById('verify-output');

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function runVerify() {
  const formId = verifyInput?.value.trim();
  if (!formId) {
    showError('Please enter a form Sui object ID.');
    return;
  }

  verifyBtn.disabled = true;
  outputEl.innerHTML = '';

  const log = createLog();

  try {
    // 1 — fetch WalForm from Sui
    log.add('spinner', 'Fetching WalForm from Sui…');
    let walForm;
    try {
      walForm = await getWalForm(formId);
      log.update('ok', `WalForm loaded — "${esc(walForm.title)}" by ${shortAddr(walForm.creator)}`);
    } catch (e) {
      log.update('err', `Could not load WalForm: ${e.message}`);
      showError(`Sui fetch failed: ${e.message}`, log.el);
      return;
    }

    // 2 — fetch + verify form definition
    log.add('spinner', 'Fetching form definition from Walrus…');
    let defBytes, defHashHex;
    try {
      defBytes = await fetchBlob(bytesToBlobId(walForm.definitionBlobId));
      defHashHex = bytesToHex(await sha256(defBytes));
      const onChainHex = fieldBytesToHex(walForm.definitionHash);
      if (defHashHex !== onChainHex) {
        log.update('err', 'Form definition hash MISMATCH — definition may be tampered.');
      } else {
        log.update('ok', `Form definition verified (SHA-256: ${defHashHex.slice(0, 16)}…)`);
      }
    } catch (e) {
      log.update('err', `Walrus fetch failed: ${e.message}`);
      showError(`Could not fetch form definition: ${e.message}`, log.el);
      return;
    }

    // 3 — fetch submission events from Sui
    log.add('spinner', 'Querying SubmissionRecorded events from Sui…');
    let events;
    try {
      events = await getSubmissionEvents(formId);
      log.update('ok', `Found ${events.length} submission event${events.length !== 1 ? 's' : ''}`);
    } catch (e) {
      log.update('err', `Event query failed: ${e.message}`);
      showError(`Could not query Sui events: ${e.message}`, log.el);
      return;
    }

    // 4 — verify each submission blob
    log.add('spinner', `Verifying ${events.length} submission${events.length !== 1 ? 's' : ''} on Walrus…`);
    const results = [];
    let allOk = true;

    for (const ev of events) {
      const blobIdStr = bytesToBlobId(ev.submissionBlobId);
      const onChainHashHex = fieldBytesToHex(ev.submissionHash);
      let status = 'ok';
      let detail = '';
      let fetchedHashHex = null;
      let rawBytes = null;

      try {
        rawBytes = await fetchBlob(blobIdStr);
        fetchedHashHex = bytesToHex(await sha256(rawBytes));
        if (fetchedHashHex !== onChainHashHex) {
          status = 'bad';
          allOk = false;
          detail = `Hash mismatch — on-chain: ${onChainHashHex.slice(0,16)}… fetched: ${fetchedHashHex.slice(0,16)}…`;
        }
      } catch (fetchErr) {
        status = 'bad';
        allOk = false;
        detail = `Blob not found: ${fetchErr.message}`;
      }

      results.push({ ev, blobIdStr, onChainHashHex, fetchedHashHex, status, detail, rawBytes });
    }
    log.update('ok', `Submission verification complete — ${results.filter(r => r.status === 'ok').length}/${results.length} passed`);

    // 5 — compute Merkle root locally
    log.add('spinner', 'Computing Merkle root…');
    const sortedHashes = events.map(ev => fieldBytesToHex(ev.submissionHash));
    const computedRoot = await merkleRoot(sortedHashes);
    const computedRootHex = bytesToHex(computedRoot);
    log.update('ok', `Merkle root computed: ${computedRootHex.slice(0, 16)}…`);

    // 6 — compare to on-chain sealed root (if sealed)
    let merkleMatch = null;
    let onChainRootHex = null;
    if (walForm.isSealed && walForm.finalManifestRoot) {
      onChainRootHex = fieldBytesToHex(walForm.finalManifestRoot);
      merkleMatch = computedRootHex === onChainRootHex;
      if (!merkleMatch) allOk = false;
      log.add(merkleMatch ? 'ok' : 'err',
        merkleMatch
          ? 'Merkle root matches on-chain sealed root — form is fully verified'
          : 'Merkle root MISMATCH — form has been tampered with after sealing'
      );
    } else {
      log.add('info', walForm.isSealed
        ? 'Form is sealed but no manifest root found on-chain'
        : 'Form is not yet sealed — Merkle root computed but not yet committed on-chain'
      );
    }

    // Render final result
    renderResult({
      walForm, events, results,
      computedRootHex, onChainRootHex, merkleMatch,
      allOk, log: log.el,
    });

  } catch (err) {
    showError(`Unexpected error: ${err.message}`, log.el);
    console.error('[verify]', err);
  } finally {
    verifyBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Render result
// ---------------------------------------------------------------------------
function renderResult({ walForm, events, results, computedRootHex, onChainRootHex, merkleMatch, allOk, log: logEl }) {
  outputEl.innerHTML = '';

  const isVerified = allOk && (merkleMatch !== false);

  // Result banner with walrus mascot
  const banner = document.createElement('div');
  banner.className = `result-banner ${isVerified ? 'verified' : 'tampered'}`;
  banner.innerHTML = `
    <div class="walrus-mascot ${isVerified ? 'verified' : ''}">
      ${walrusSVG(isVerified)}
    </div>
    <div>
      <span class="${isVerified ? 'badge-verified-pulse' : 'badge-tampered'}">
        ${isVerified ? '✓ Verified' : '✕ Tampered'}
      </span>
    </div>
    <h2 style="margin-top:var(--sp-4);">
      ${isVerified
        ? `All ${results.length} submission${results.length !== 1 ? 's' : ''} verified`
        : `Integrity check failed`}
    </h2>
    <p style="color:var(--color-muted);font-size:var(--text-sm);">
      ${isVerified
        ? 'Every submission hash matches its on-chain record. The Merkle root is consistent.'
        : 'One or more submissions failed hash verification, or the Merkle root does not match the sealed on-chain root.'}
    </p>
  `;
  outputEl.append(banner);

  // Step log
  outputEl.append(logEl);

  // Merkle section
  const merkleEl = document.createElement('div');
  merkleEl.className = 'merkle-section';
  merkleEl.innerHTML = `
    <h3>Merkle root</h3>
    <dl class="merkle-row">
      <dt>Computed locally (${results.length} submissions)</dt>
      <dd>${computedRootHex || '(empty)'}</dd>
      ${onChainRootHex ? `
        <dt>On-chain sealed root</dt>
        <dd>${onChainRootHex}</dd>
        <dt>Match</dt>
        <dd class="${merkleMatch ? 'merkle-match' : 'merkle-mismatch'}">
          ${merkleMatch ? 'Yes — root matches' : 'No — MISMATCH'}
        </dd>
      ` : `
        <dt>On-chain sealed root</dt>
        <dd style="color:var(--color-muted)">${walForm.isSealed ? 'Sealed but no root found' : 'Not yet sealed'}</dd>
      `}
    </dl>
    ${events.length > 0 ? `
      <div style="margin-top:var(--sp-4);">
        <button id="dl-all-blobs" class="btn btn-ghost" type="button">Download all ${results.length} submission blobs as ZIP</button>
      </div>
    ` : ''}
  `;
  outputEl.append(merkleEl);

  // Download button
  if (results.length > 0) {
    document.getElementById('dl-all-blobs')?.addEventListener('click', () => downloadAllBlobs(results));
  }

  // Submissions list
  if (results.length > 0) {
    const listWrap = document.createElement('div');
    listWrap.style.marginTop = 'var(--sp-6)';
    listWrap.innerHTML = `<h3 style="margin-bottom:var(--sp-4);">Submissions (${results.length})</h3>`;

    const list = document.createElement('div');
    list.className = 'sub-list';

    results.forEach(r => {
      const row = document.createElement('div');
      row.className = `sub-row ${r.status}`;
      row.innerHTML = `
        <div class="sub-seq">#${r.ev.sequence + 1}</div>
        <div class="sub-meta">
          <span class="sub-status ${r.status}">${r.status === 'ok' ? 'Hash verified' : 'FAILED'}</span>
          <span class="step-log-mono">Blob: ${r.blobIdStr.slice(0, 20)}…</span>
          <span class="step-log-mono">Submitter: ${shortAddr(r.ev.submitter)}</span>
          ${r.detail ? `<span style="color:var(--color-red);font-size:12px">${esc(r.detail)}</span>` : ''}
        </div>
        <div>
          <a href="https://suiscan.xyz/mainnet/tx/${r.ev.txDigest ?? ''}" target="_blank" rel="noopener"
             class="btn btn-ghost" style="font-size:12px;padding:4px 10px;">Suiscan</a>
        </div>
      `;
      list.append(row);
    });

    listWrap.append(list);
    outputEl.append(listWrap);
  } else {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:var(--color-muted);font-size:var(--text-sm);margin-top:var(--sp-6)';
    empty.textContent = 'No submissions recorded yet for this form.';
    outputEl.append(empty);
  }
}

// ---------------------------------------------------------------------------
// Download all blobs as ZIP (JSZip via CDN)
// ---------------------------------------------------------------------------
async function downloadAllBlobs(results) {
  const btn = document.getElementById('dl-all-blobs');
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing ZIP…'; }

  try {
    const { default: JSZip } = await import('https://esm.sh/jszip');
    const zip = new JSZip();

    for (const r of results) {
      if (!r.rawBytes) continue;
      const filename = `submission-${String(r.ev.sequence + 1).padStart(3, '0')}-${r.blobIdStr.slice(0, 8)}.json`;
      zip.file(filename, r.rawBytes);
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'walforms-submissions.zip';
    a.click();
  } catch (e) {
    window.walformsApp?.showStatusMessage(`ZIP failed: ${e.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = `Download all ${results.length} submission blobs as ZIP`; }
  }
}

// ---------------------------------------------------------------------------
// Step log builder
// ---------------------------------------------------------------------------
function createLog() {
  const el = document.createElement('div');
  el.className = 'step-log';
  let currentItem = null;

  return {
    el,
    add(type, text) {
      const item = document.createElement('div');
      item.className = 'step-log-item';
      item.innerHTML = `
        <span class="step-log-icon">${iconFor(type)}</span>
        <span class="step-log-text">${esc(text)}</span>
      `;
      el.append(item);
      currentItem = item;
    },
    update(type, text) {
      if (!currentItem) return this.add(type, text);
      currentItem.innerHTML = `
        <span class="step-log-icon">${iconFor(type)}</span>
        <span class="step-log-text">${esc(text)}</span>
      `;
    },
  };
}

function iconFor(type) {
  return {
    spinner: '<span class="spinner"></span>',
    ok:   '<span style="color:var(--color-cyan)">✓</span>',
    err:  '<span style="color:var(--color-red)">✕</span>',
    info: '<span style="color:var(--color-muted)">·</span>',
  }[type] ?? '·';
}

// ---------------------------------------------------------------------------
// Error display
// ---------------------------------------------------------------------------
function showError(msg, logEl) {
  outputEl.innerHTML = '';
  if (logEl) outputEl.append(logEl);
  const el = document.createElement('div');
  el.style.cssText = 'margin-top:var(--sp-5);padding:var(--sp-5);border:2px solid var(--color-red);border-radius:var(--radius-md);background:rgba(224,72,72,.04)';
  el.innerHTML = `<strong style="color:var(--color-red)">Verification error</strong><p style="font-size:var(--text-sm);margin-top:var(--sp-2)">${esc(msg)}</p>`;
  outputEl.append(el);
}

// ---------------------------------------------------------------------------
// Walrus mascot SVG
// ---------------------------------------------------------------------------
function walrusSVG(waving) {
  return `
  <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- body -->
    <ellipse cx="40" cy="50" rx="26" ry="22" fill="#8E63FF" opacity=".9"/>
    <!-- head -->
    <ellipse cx="40" cy="28" rx="18" ry="16" fill="#8E63FF" opacity=".9"/>
    <!-- face white -->
    <ellipse cx="40" cy="30" rx="11" ry="9" fill="#FAF8F5"/>
    <!-- eyes -->
    <circle cx="36" cy="27" r="2.5" fill="#1A1B23"/>
    <circle cx="44" cy="27" r="2.5" fill="#1A1B23"/>
    <!-- eye shine -->
    <circle cx="37" cy="26" r=".8" fill="#fff"/>
    <circle cx="45" cy="26" r=".8" fill="#fff"/>
    <!-- nose -->
    <ellipse cx="40" cy="32" rx="3" ry="2" fill="#6B6F7A"/>
    <!-- tusks -->
    <rect x="35" y="36" width="3" height="8" rx="1.5" fill="#FAF8F5"/>
    <rect x="42" y="36" width="3" height="8" rx="1.5" fill="#FAF8F5"/>
    <!-- flippers / arms -->
    <ellipse class="walrus-arm" cx="18" cy="52" rx="7" ry="4" fill="#7A52E0" opacity=".85"
      transform="rotate(-30 18 52)"/>
    <ellipse cx="62" cy="52" rx="7" ry="4" fill="#7A52E0" opacity=".85"
      transform="rotate(30 62 52)"/>
    <!-- tail -->
    <ellipse cx="40" cy="70" rx="8" ry="4" fill="#7A52E0" opacity=".7"/>
    ${waving ? '<!-- wave sparkle --><circle cx="14" cy="38" r="3" fill="#0ED0C8" opacity=".8"/><circle cx="8" cy="46" r="2" fill="#0ED0C8" opacity=".5"/>' : ''}
  </svg>`;
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
  return String(field ?? '');
}

function shortAddr(addr) {
  if (!addr) return 'anon';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function init() {
  verifyBtn?.addEventListener('click', runVerify);

  // Support ?id= in URL to auto-verify
  const id = new URLSearchParams(location.search).get('id');
  if (id && verifyInput) {
    verifyInput.value = id;
    runVerify();
  }

  verifyInput?.addEventListener('keydown', e => { if (e.key === 'Enter') runVerify(); });
}

document.addEventListener('DOMContentLoaded', init);

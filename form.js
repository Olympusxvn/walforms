// form.js — public form filler: load → verify integrity → render → submit → receipt.

import { fetchBlob, uploadBlob, curlFallback, WalrusUploadError } from './walrus.js';
import { sha256, bytesToHex } from './crypto.js';
import { renderFieldInput, readFieldValue, normalizeWalletAddress } from './fields.js';
import {
  getWalForm,
  txRecordSubmission,
  isWalletConnected,
  getConnectedAddress,
} from './sui.js';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const loadStateEl     = document.getElementById('load-state');
const loadMessageEl   = document.getElementById('load-message');
const integrityErrEl  = document.getElementById('integrity-error');
const intDetailEl     = document.getElementById('integrity-detail');
const formContainerEl = document.getElementById('form-container');
const formHeaderEl    = document.getElementById('form-header');
const anonNoticeEl    = document.getElementById('anon-notice');
const formFieldsEl    = document.getElementById('form-fields');
const submissionForm  = document.getElementById('submission-form');
const confirmPerm     = document.getElementById('confirm-permanent');
const submitBtn       = document.getElementById('submit-btn');
const submitHintEl    = document.getElementById('submit-hint');
const submitProgressEl= document.getElementById('submit-progress');
const receiptEl       = document.getElementById('receipt');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let walForm = null;          // on-chain WalForm object
let formDef = null;          // parsed form definition JSON
let formDefHashHex = null;   // SHA-256 hex of the fetched blob (for submission)
let fieldWrappers = [];      // [{ field, wrapper }] for reading values

// ---------------------------------------------------------------------------
// Loading helpers
// ---------------------------------------------------------------------------
function setLoading(msg) {
  if (loadMessageEl) loadMessageEl.textContent = msg;
  loadStateEl && (loadStateEl.hidden = false);
}

function hideLoading() {
  loadStateEl && (loadStateEl.hidden = true);
}

function showIntegrityError(onChainHash, fetchedHash) {
  hideLoading();
  integrityErrEl && (integrityErrEl.hidden = false);
  if (intDetailEl) {
    intDetailEl.textContent =
      `On-chain hash:  ${onChainHash}\nFetched blob hash: ${fetchedHash}`;
  }
}

// ---------------------------------------------------------------------------
// Step-by-step submit progress
// ---------------------------------------------------------------------------
const SUBMIT_STEPS = [
  { key: 'files',   label: '1. Uploading file attachments to Walrus…' },
  { key: 'hash',    label: '2. Computing submission hash…' },
  { key: 'upload',  label: '3. Uploading submission to Walrus…' },
  { key: 'sign',    label: '4. Signing Sui transaction (0.0005 SUI platform fee)…' },
  { key: 'confirm', label: '5. Waiting for confirmation…' },
];

function renderSubmitSteps(activeKey, statuses = {}) {
  if (!submitProgressEl) return;
  submitProgressEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'submit-steps';

  SUBMIT_STEPS.forEach(step => {
    const status = statuses[step.key] ?? (step.key === activeKey ? 'active' : 'idle');
    const div = document.createElement('div');
    div.className = 'submit-step';
    div.dataset.status = status;
    const icons = { done: '✓', active: '⋯', error: '✕', idle: '○' };
    const colors = { done: 'var(--color-cyan)', active: 'var(--color-primary)', error: 'var(--color-red)', idle: 'var(--color-muted)' };
    div.innerHTML = `
      <span class="step-icon" style="color:${colors[status] ?? colors.idle}">${icons[status] ?? '○'}</span>
      <span>${step.label}</span>
      ${statuses[`${step.key}_detail`] ? `<span style="font-size:11px;color:var(--color-muted);margin-left:auto;font-family:var(--font-mono)">${statuses[`${step.key}_detail`]}</span>` : ''}
    `;
    wrap.append(div);
  });

  submitProgressEl.append(wrap);
}

function clearSubmitProgress() {
  if (submitProgressEl) submitProgressEl.innerHTML = '';
}

// ---------------------------------------------------------------------------
// Init: load form from Sui + Walrus
// ---------------------------------------------------------------------------
async function initForm() {
  const formId = new URLSearchParams(location.search).get('id');

  if (!formId) {
    setLoading('Missing form ID. Use a URL like form.html?id=<SUI_OBJECT_ID>');
    return;
  }

  // Step 1 — fetch WalForm object from Sui
  setLoading('Fetching form from Sui…');
  try {
    walForm = await getWalForm(formId);
  } catch (err) {
    setLoading(`Could not load form from Sui: ${err.message}`);
    return;
  }

  if (walForm.isSealed) {
    setLoading('This form is sealed. Submissions are no longer accepted.');
    return;
  }

  // Step 2 — fetch definition blob from Walrus
  setLoading('Fetching form definition from Walrus…');
  let blobBytes;
  try {
    blobBytes = await fetchBlob(bytesToBlobId(walForm.definitionBlobId));
  } catch (err) {
    setLoading(`Could not fetch form definition from Walrus: ${err.message}`);
    return;
  }

  // Step 3 — verify SHA-256 matches on-chain definition_hash
  const fetchedHashBytes = await sha256(blobBytes);
  const fetchedHashHex = bytesToHex(fetchedHashBytes);
  const onChainHashHex = fieldBytesToHex(walForm.definitionHash);
  formDefHashHex = fetchedHashHex;

  if (fetchedHashHex !== onChainHashHex) {
    showIntegrityError(onChainHashHex, fetchedHashHex);
    return;
  }

  // Step 4 — parse and render
  try {
    formDef = JSON.parse(new TextDecoder().decode(blobBytes));
  } catch {
    setLoading('Form definition is not valid JSON.');
    return;
  }

  hideLoading();
  renderFormUI();
  window.addEventListener('walforms:wallet-changed', updateWalletGateUI);
}

function updateWalletGateUI() {
  if (!formContainerEl || formContainerEl.hidden) return;
  applyWalletGateToFormPage();
}

/**
 * Wallet required to submit; fee is taken in the same TX as record_submission.
 */
function applyWalletGateToFormPage() {
  const connected = isWalletConnected();
  const addr = getConnectedAddress();

  if (anonNoticeEl) {
    if (connected) {
      anonNoticeEl.hidden = true;
    } else {
      anonNoticeEl.hidden = false;
      anonNoticeEl.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:1px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <div>
          <strong>Connect a Sui wallet to submit</strong>
          Submissions are recorded on-chain. You will sign one transaction that includes
          <strong>0.0005 SUI</strong> sent to the WalForms admin address (same transaction as your response).
          Use <strong>Connect wallet</strong> in the header (e.g. Slush).
        </div>
      `;
    }
  }

  if (submitBtn) submitBtn.disabled = !connected;
  if (submitHintEl) {
    submitHintEl.textContent = connected
      ? `Ready to submit as ${addr?.slice(0, 10)}… (includes 0.0005 SUI fee)`
      : 'Connect your wallet in the header to enable Submit.';
  }
}

// ---------------------------------------------------------------------------
// Render the form
// ---------------------------------------------------------------------------
function renderFormUI() {
  if (!formDef || !formContainerEl) return;

  // Header
  if (formHeaderEl) {
    formHeaderEl.innerHTML = `
      <h1 style="margin-bottom:var(--sp-2)">${esc(formDef.title || 'Untitled form')}</h1>
      ${formDef.description ? `<p style="color:var(--color-muted);font-size:var(--text-sm);margin-bottom:var(--sp-4)">${esc(formDef.description)}</p>` : ''}
      <div class="form-meta">
        <span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Verified on Sui
        </span>
        <span>${formDef.fields?.length ?? 0} fields</span>
        <span>Wallet required · 0.0005 SUI fee on submit</span>
      </div>
    `;
  }

  applyWalletGateToFormPage();

  // Fields
  fieldWrappers = [];
  formFieldsEl && (formFieldsEl.innerHTML = '');
  (formDef.fields ?? []).forEach(field => {
    const wrapper = renderFieldInput(field);
    fieldWrappers.push({ field, wrapper });
    formFieldsEl?.append(wrapper);
  });

  formContainerEl.hidden = false;
  submissionForm?.addEventListener('submit', handleSubmit);
}

// ---------------------------------------------------------------------------
// Submit handler
// ---------------------------------------------------------------------------
async function handleSubmit(e) {
  e.preventDefault();

  if (!confirmPerm?.checked) {
    confirmPerm?.focus();
    window.walformsApp?.showStatusMessage('Please acknowledge that your submission is permanent before submitting.', 'error');
    return;
  }

  // Validate required fields
  for (const { field, wrapper } of fieldWrappers) {
    if (!field.required) continue;
    const val = readFieldValue(field, wrapper);
    const empty = val === null || val === '' || val === false
      || (Array.isArray(val) && val.length === 0)
      || (field.type === 'rating' && !val);
    if (empty) {
      wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.walformsApp?.showStatusMessage(`"${field.label}" is required.`, 'error');
      return;
    }
    if (field.type === 'walletAddress') {
      const raw = readFieldValue(field, wrapper);
      if (raw && !normalizeWalletAddress(raw)) {
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.walformsApp?.showStatusMessage(
          `"${field.label}" must be a valid Sui address (0x + 64 hex, or 64 hex without 0x).`,
          'error',
        );
        return;
      }
    }
  }

  if (!isWalletConnected()) {
    window.walformsApp?.showStatusMessage(
      'Connect your Sui wallet in the header to submit. Submitting records your response on-chain and sends 0.0005 SUI to the WalForms admin address in the same transaction.',
      'error',
    );
    return;
  }

  window.walformsApp?.clearStatusMessage?.();
  submitBtn.disabled = true;
  const statuses = {};

  try {
    // Step 1 — upload file attachments
    renderSubmitSteps('files', statuses);
    const answers = {};
    let fileCount = 0;

    for (const { field, wrapper } of fieldWrappers) {
      const val = readFieldValue(field, wrapper);
      if ((field.type === 'screenshot' || field.type === 'video' || field.type === 'logoImage' || field.type === 'bannerImage') && val instanceof File) {
        const fileBytes = await val.arrayBuffer();
        try {
          const res = await uploadBlob(fileBytes, { epochs: 5 });
          answers[field.id] = res.blobId;
          fileCount++;
        } catch (fileErr) {
          throw new Error(`Failed to upload ${field.label}: ${fileErr.message}`);
        }
      } else if (field.type === 'walletAddress' && typeof val === 'string' && val) {
        answers[field.id] = normalizeWalletAddress(val);
      } else {
        answers[field.id] = val;
      }
    }
    statuses.files = 'done';
    statuses.files_detail = fileCount > 0 ? `${fileCount} file(s)` : 'none';

    // Step 2 — hash
    renderSubmitSteps('hash', statuses);
    const submitter = getConnectedAddress();
    const submission = {
      schemaVersion: 'walforms/v1',
      formId: walForm.id,
      formBlobHash: formDefHashHex,
      submittedAt: Date.now(),
      submitter,
      answers,
    };
    const submissionJson = JSON.stringify(submission, null, 2);
    const hashBytes = await sha256(submissionJson);
    const hashHex = bytesToHex(hashBytes);
    statuses.hash = 'done';
    statuses.hash_detail = hashHex.slice(0, 12) + '…';

    // Step 3 — upload submission blob
    renderSubmitSteps('upload', statuses);
    let subBlobId;
    try {
      const res = await uploadBlob(new TextEncoder().encode(submissionJson), { epochs: 5 });
      subBlobId = res.blobId;
    } catch (upErr) {
      statuses.upload = 'error';
      renderSubmitSteps('upload', statuses);
      showCurlFallbackInline(submissionJson);
      submitBtn.disabled = false;
      applyWalletGateToFormPage();
      return;
    }
    statuses.upload = 'done';
    statuses.upload_detail = subBlobId.slice(0, 12) + '…';

    // Step 4 — Sui TX (includes 0.0005 SUI platform fee in the same PTB)
    renderSubmitSteps('sign', statuses);
    let txResult;
    try {
      txResult = await txRecordSubmission(walForm.id, subBlobId, hashBytes);
    } catch (txErr) {
      statuses.sign = 'error';
      renderSubmitSteps('sign', statuses);
      window.walformsApp?.showStatusMessage(`Sui TX failed: ${txErr.message}`, 'error');
      submitBtn.disabled = false;
      applyWalletGateToFormPage();
      return;
    }
    statuses.sign = 'done';

    // Step 5 — confirm
    renderSubmitSteps('confirm', statuses);
    statuses.confirm = 'done';
    renderSubmitSteps('confirm', statuses);

    // Show receipt
    const txDigest = txResult?.digest ?? txResult?.effects?.transactionDigest ?? '(unknown)';
    showReceipt({ subBlobId, hashHex, txDigest, submitter });

  } catch (err) {
    window.walformsApp?.showStatusMessage(`Submission failed: ${err.message}`, 'error');
    console.error('[form] submit error', err);
    submitBtn.disabled = false;
    applyWalletGateToFormPage();
  }
}


// ---------------------------------------------------------------------------
// Curl fallback inline (upload step failed)
// ---------------------------------------------------------------------------
function showCurlFallbackInline(json) {
  if (!submitProgressEl) return;
  const div = document.createElement('div');
  div.style.cssText = 'margin-top:var(--sp-5);padding:var(--sp-5);background:#F8F6FF;border-radius:var(--radius-md);border:1.5px solid rgba(142,99,255,.25)';
  const file = 'submission.json';
  const cmd = curlFallback(5, file, 0);
  const cmdAlt = curlFallback(5, file, 1);
  const cmdWin = cmd.replace(/^curl\b/, 'curl.exe');
  const cmdWinAlt = cmdAlt ? cmdAlt.replace(/^curl\b/, 'curl.exe') : '';
  const altBlock = cmdAlt
    ? `
    <p style="font-size:11px;color:var(--color-muted);margin:var(--sp-3) 0 var(--sp-2)">
      <strong>Alternate publisher</strong> (if DNS fails on the first URL):
    </p>
    <pre style="font-size:12px;white-space:pre-wrap;word-break:break-all">${cmdAlt}</pre>
    <p style="font-size:11px;color:var(--color-muted);margin:var(--sp-2) 0">PowerShell-friendly:</p>
    <pre style="font-size:12px;white-space:pre-wrap;word-break:break-all">${cmdWinAlt}</pre>`
    : '';
  div.innerHTML = `
    <strong style="font-size:var(--text-sm)">All Walrus publishers failed</strong>
    <p style="font-size:var(--text-sm);color:var(--color-muted);margin:var(--sp-2) 0">
      Save your submission JSON and upload manually:
    </p>
    <p style="font-size:11px;color:var(--color-muted);margin:0 0 var(--sp-2)">
      <strong>Windows PowerShell:</strong> use <code style="font-family:var(--font-mono)">curl.exe</code> instead of <code style="font-family:var(--font-mono)">curl</code>.
    </p>
    <pre style="font-size:12px;white-space:pre-wrap;word-break:break-all">${cmd}</pre>
    <p style="font-size:11px;color:var(--color-muted);margin:var(--sp-2) 0">PowerShell-friendly:</p>
    <pre style="font-size:12px;white-space:pre-wrap;word-break:break-all">${cmdWin}</pre>
    ${altBlock}
    <button id="dl-submission-json" class="btn btn-ghost" style="margin-top:var(--sp-3)" type="button">Download submission.json</button>
  `;
  submitProgressEl.append(div);
  div.querySelector('#dl-submission-json')?.addEventListener('click', () => {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'submission.json';
    a.click();
  });
}

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------
function showReceipt({ subBlobId, hashHex, txDigest, submitter }) {
  if (formContainerEl) formContainerEl.hidden = true;
  clearSubmitProgress();

  const blobEl     = document.getElementById('receipt-blob-id');
  const hashEl     = document.getElementById('receipt-hash');
  const txEl       = document.getElementById('receipt-tx');
  const subEl      = document.getElementById('receipt-submitter');
  const suiscanEl  = document.getElementById('receipt-suiscan-link');

  if (blobEl)    blobEl.textContent = subBlobId;
  if (hashEl)    hashEl.textContent = hashHex;
  if (txEl)      txEl.textContent = txDigest;
  if (subEl)     subEl.textContent = submitter;
  if (suiscanEl) suiscanEl.href = `https://suiscan.xyz/mainnet/tx/${txDigest}`;

  receiptEl && (receiptEl.hidden = false);
  receiptEl?.scrollIntoView({ behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert on-chain definition_blob_id (array of numbers) to a Walrus blob ID string. */
function bytesToBlobId(blobIdField) {
  if (typeof blobIdField === 'string') return blobIdField;
  if (Array.isArray(blobIdField)) {
    // Walrus blob IDs are base64url encoded 32-byte values; on-chain stored as bytes
    const bytes = new Uint8Array(blobIdField);
    // base64url encode
    let binary = '';
    bytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return String(blobIdField);
}

/** Convert on-chain hash field (array of numbers or hex string) to hex string. */
function fieldBytesToHex(field) {
  if (typeof field === 'string') return field.startsWith('0x') ? field.slice(2) : field;
  if (Array.isArray(field)) return bytesToHex(new Uint8Array(field));
  return String(field);
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', initForm);

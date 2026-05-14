// builder.js — form builder logic: palette, canvas drag-drop, properties, save flow.

import { FIELD_TYPES, createField, renderPaletteChip, renderCanvasCard, renderFieldSettings } from './fields.js';
import { sha256, bytesToHex } from './crypto.js';
import { uploadBlob, curlFallback } from './walrus.js';
import { txCreateForm, isWalletConnected, getConnectedAddress } from './sui.js';

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const palette       = document.getElementById('field-palette');
const templateList  = document.getElementById('template-list');
const canvas        = document.getElementById('form-canvas');
const emptyState    = document.getElementById('canvas-empty-state');
const propertiesEl  = document.getElementById('field-properties');
const progressEl    = document.getElementById('builder-progress');
const saveBtn       = document.getElementById('save-form-btn');
const titleInput    = document.getElementById('form-title-input');
const modal         = document.getElementById('success-modal');
const modalShareUrl = document.getElementById('modal-share-url');
const modalCopyBtn  = document.getElementById('modal-copy-btn');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalFormLink = document.getElementById('modal-form-link');
const modalDashLink = document.getElementById('modal-dashboard-link');
const modalBlobId   = document.getElementById('modal-blob-id');
const modalFormId   = document.getElementById('modal-form-id');
const modalHash     = document.getElementById('modal-hash');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  fields: [],
  selectedId: null,
  dragSrcIndex: null,  // index of field being dragged on canvas
};

function getField(id) { return state.fields.find(f => f.id === id); }
function getIndex(id) { return state.fields.findIndex(f => f.id === id); }

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function buildField(type, overrides = {}) {
  const base = createField(type);
  return Object.assign(base, overrides);
}

const TEMPLATES = {
  websiteFeedback: () => ({
    title: 'Website feedback',
    fields: [
      buildField('shortText', {
        label: 'Page or feature you are giving feedback on',
        required: false,
      }),
      buildField('rating', {
        label: 'Overall experience with the website',
        helpText: 'From 1 (very poor) to 5 (excellent).',
        scale: 5,
      }),
      buildField('longText', {
        label: 'What worked well for you?',
        required: false,
      }),
      buildField('longText', {
        label: 'Anything that felt confusing or could be smoother?',
        required: false,
      }),
      buildField('email', {
        label: 'Email (optional, for follow-up only)',
        required: false,
      }),
      buildField('confirmationCheckbox', {
        label: 'I understand this feedback will be stored permanently.',
        required: true,
        helpText: 'Your answers cannot be edited or removed after submission.',
      }),
    ],
  }),

  customerSurvey: () => ({
    title: 'Customer survey',
    fields: [
      buildField('shortText', {
        label: 'Name',
        required: false,
      }),
      buildField('email', {
        label: 'Email',
        required: false,
      }),
      buildField('rating', {
        label: 'How satisfied are you overall?',
        helpText: '1 = not satisfied, 5 = very satisfied.',
        scale: 5,
      }),
      buildField('singleChoice', {
        label: 'Would you recommend us to a friend?',
        options: ['Definitely', 'Maybe', 'Not sure yet'],
      }),
      buildField('longText', {
        label: 'What did you find most helpful?',
        required: false,
      }),
      buildField('longText', {
        label: 'What could we improve for you?',
        required: false,
      }),
    ],
  }),

  travelRequest: () => ({
    title: 'Travel request',
    fields: [
      buildField('shortText', {
        label: 'Full name',
      }),
      buildField('email', {
        label: 'Work email',
      }),
      buildField('shortText', {
        label: 'Team or department',
      }),
      buildField('shortText', {
        label: 'Destination city / country',
      }),
      buildField('date', {
        label: 'Departure date',
      }),
      buildField('date', {
        label: 'Return date',
      }),
      buildField('singleChoice', {
        label: 'Travel type',
        options: ['Domestic', 'International'],
      }),
      buildField('number', {
        label: 'Estimated budget (in local currency)',
        required: false,
      }),
      buildField('longText', {
        label: 'Purpose of this trip',
      }),
      buildField('longText', {
        label: 'Additional notes (visa, hotel, special requirements)',
        required: false,
      }),
      buildField('confirmationCheckbox', {
        label: 'I confirm the information above is accurate to the best of my knowledge.',
        required: true,
      }),
    ],
  }),
};

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
function buildPalette() {
  if (!palette) return;
  FIELD_TYPES.forEach(ft => {
    const chip = renderPaletteChip(ft);

    // Click to add
    chip.addEventListener('click', () => addField(ft.type));

    // Drag from palette onto canvas
    chip.addEventListener('dragstart', e => {
      e.dataTransfer.setData('application/wf-palette', ft.type);
      e.dataTransfer.effectAllowed = 'copy';
    });

    palette.append(chip);
  });
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------
function addField(type) {
  const field = createField(type);
  if (!field) return;
  state.fields.push(field);
  state.selectedId = field.id;
  renderCanvas();
  renderProperties();
}

function removeField(id) {
  const idx = getIndex(id);
  if (idx === -1) return;
  state.fields.splice(idx, 1);
  if (state.selectedId === id) state.selectedId = state.fields[idx - 1]?.id ?? state.fields[0]?.id ?? null;
  renderCanvas();
  renderProperties();
}

function selectField(id) {
  state.selectedId = id;
  renderCanvas();
  renderProperties();
}

function renderCanvas() {
  if (!canvas) return;

  // Remove old field cards (keep empty-state node)
  canvas.querySelectorAll('.canvas-field').forEach(n => n.remove());

  if (state.fields.length === 0) {
    emptyState && (emptyState.hidden = false);
    return;
  }
  emptyState && (emptyState.hidden = true);

  state.fields.forEach((field, i) => {
    const card = renderCanvasCard(field, {
      selected: field.id === state.selectedId,
      onSelect: () => selectField(field.id),
      onDelete: () => removeField(field.id),
    });

    // Canvas reorder drag
    card.addEventListener('dragstart', e => {
      state.dragSrcIndex = i;
      e.dataTransfer.setData('application/wf-reorder', String(i));
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => card.style.opacity = '0.4', 0);
    });
    card.addEventListener('dragend', () => { card.style.opacity = ''; });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/wf-reorder') ? 'move' : 'copy';
      card.classList.add('drag-target');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-target'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-target');
      if (e.dataTransfer.types.includes('application/wf-reorder')) {
        const src = state.dragSrcIndex;
        if (src === null || src === i) return;
        const [moved] = state.fields.splice(src, 1);
        state.fields.splice(i, 0, moved);
        state.dragSrcIndex = null;
        renderCanvas();
        renderProperties();
      }
    });

    canvas.append(card);
  });
}

function applyTemplate(id) {
  const factory = TEMPLATES[id];
  if (!factory) return;
  const { title, fields } = factory();

  const hasExistingContent = (state.fields.length > 0) || (titleInput && titleInput.value.trim().length > 0);
  if (hasExistingContent && !window.confirm('Apply template? This will replace the current fields.')) {
    return;
  }

  state.fields = fields;
  state.selectedId = state.fields[0]?.id ?? null;
  if (titleInput) titleInput.value = title;

  renderCanvas();
  renderProperties();
  window.walformsApp?.showStatusMessage?.('Template applied. You can now customize the fields.', 'info');
}

function renderProperties() {
  if (!propertiesEl) return;
  propertiesEl.innerHTML = '';

  const field = state.selectedId ? getField(state.selectedId) : null;
  if (!field) {
    propertiesEl.innerHTML = '<div class="props-empty">Select a field to edit its settings</div>';
    return;
  }

  const settings = renderFieldSettings(field, () => renderCanvas());
  propertiesEl.append(settings);
}

// Canvas drop zone (for palette drags)
function attachCanvasDrop() {
  if (!canvas) return;
  canvas.addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('application/wf-palette')) {
      e.preventDefault();
      canvas.classList.add('drag-over');
    }
  });
  canvas.addEventListener('dragleave', () => canvas.classList.remove('drag-over'));
  canvas.addEventListener('drop', e => {
    canvas.classList.remove('drag-over');
    const type = e.dataTransfer.getData('application/wf-palette');
    if (type) addField(type);
  });
}

// ---------------------------------------------------------------------------
// Save flow
// ---------------------------------------------------------------------------
const STEPS = [
  { key: 'hash',    label: '1. Computing definition hash…' },
  { key: 'upload',  label: '2. Uploading to Walrus…' },
  { key: 'sign',    label: '3. Awaiting Sui signature (0.0005 SUI platform fee)…' },
  { key: 'confirm', label: '4. Waiting for confirmation…' },
];

function renderProgressSteps(activeKey, statuses = {}) {
  if (!progressEl) return;
  progressEl.innerHTML = '';

  const stepsEl = document.createElement('div');
  stepsEl.className = 'progress-steps';

  STEPS.forEach(step => {
    const status = statuses[step.key] ?? (step.key === activeKey ? 'active' : 'idle');
    const div = document.createElement('div');
    div.className = 'progress-step';
    div.dataset.status = status;

    const icons = { done: '✓', active: '⋯', error: '✕', idle: '○' };
    div.innerHTML = `
      <span class="step-icon" style="color:${status === 'done' ? 'var(--color-cyan)' : status === 'error' ? 'var(--color-red)' : status === 'active' ? 'var(--color-primary)' : 'var(--color-muted)'}">${icons[status] ?? '○'}</span>
      <span class="step-text">${step.label}</span>
    `;
    stepsEl.append(div);
  });

  progressEl.append(stepsEl);
}

function clearProgress() { if (progressEl) progressEl.innerHTML = ''; }

function showCurlFallback(blobBytes) {
  if (!progressEl) return;
  const file = 'form-definition.json';
  const cmd = curlFallback(5, file, 0);
  const cmdAlt = curlFallback(5, file, 1);
  const cmdWin = cmd.replace(/^curl\b/, 'curl.exe');
  const cmdWinAlt = cmdAlt ? cmdAlt.replace(/^curl\b/, 'curl.exe') : '';
  const altBlock = cmdAlt
    ? `
    <p style="font-size:11px;color:var(--color-muted);margin:var(--sp-4) 0 0">
      <strong>Alternate publisher</strong> (if the first URL fails DNS — <code>curl: (6) Could not resolve host</code>):
    </p>
    <pre>${cmdAlt}</pre>
    <p style="font-size:11px;color:var(--color-muted);margin:var(--sp-2) 0 0">PowerShell-friendly:</p>
    <pre>${cmdWinAlt}</pre>`
    : '';
  const div = document.createElement('div');
  div.className = 'curl-fallback';
  div.innerHTML = `
    <strong>All Walrus publishers failed</strong>
    <p style="font-size:var(--text-sm);color:var(--color-muted);margin:var(--sp-2) 0 0">
      Run this command from your terminal to upload the form definition manually:
    </p>
    <p style="font-size:11px;color:var(--color-muted);margin:var(--sp-2) 0 0">
      <strong>Windows PowerShell:</strong> use <code style="font-family:var(--font-mono)">curl.exe</code> (not <code style="font-family:var(--font-mono)">curl</code>) — PowerShell maps <code>curl</code> to <code>Invoke-WebRequest</code>, which does not support <code>-X</code>.
    </p>
    <pre>${cmd}</pre>
    <p style="font-size:11px;color:var(--color-muted);margin:var(--sp-2) 0 0">PowerShell-friendly (same request):</p>
    <pre>${cmdWin}</pre>
    ${altBlock}
    <p style="font-size:var(--text-sm);color:var(--color-muted);margin:var(--sp-4) 0 var(--sp-2)">
      Already uploaded manually? Paste the Blob ID here:
    </p>
    <div class="manual-blob-row">
      <input id="manual-blob-input" class="field-input" placeholder="Blob ID from walrus store output" style="flex:1" />
      <button id="manual-blob-continue" class="btn btn-primary" type="button">Continue with this Blob ID</button>
    </div>
  `;
  progressEl.append(div);
  // Return a promise that resolves with the manually entered blob ID
  return new Promise(resolve => {
    div.querySelector('#manual-blob-continue').addEventListener('click', () => {
      const val = div.querySelector('#manual-blob-input').value.trim();
      if (val) resolve(val);
    });
  });
}

async function saveForm() {
  // Validate
  const title = titleInput?.value.trim() || '';
  if (!title) {
    titleInput?.focus();
    titleInput?.classList.add('input-error');
    window.walformsApp?.showStatusMessage('Please enter a form title before saving.', 'error');
    return;
  }
  titleInput?.classList.remove('input-error');

  if (state.fields.length === 0) {
    window.walformsApp?.showStatusMessage('Add at least one field before saving.', 'error');
    return;
  }

  if (!isWalletConnected()) {
    window.walformsApp?.showStatusMessage(
      'Connect your Sui wallet first. Saving registers the form on-chain and sends a 0.0005 SUI platform fee to the admin address.',
      'error',
    );
    return;
  }

  saveBtn.disabled = true;
  window.walformsApp?.clearStatusMessage?.();

  const statuses = {};

  try {
    // Step 1 — hash
    renderProgressSteps('hash', statuses);
    const formDef = {
      schemaVersion: 'walforms/v1',
      title,
      description: '',
      createdAt: Date.now(),
      creator: getConnectedAddress(),
      fields: state.fields,
      settings: { private: false, allowAnonymous: false, submissionLimit: 0 },
    };
    const formJson = JSON.stringify(formDef, null, 2);
    const hashBytes = await sha256(formJson);
    const hashHex = bytesToHex(hashBytes);
    statuses.hash = 'done';

    // Step 2 — upload to Walrus
    renderProgressSteps('upload', statuses);
    let blobId;
    try {
      const result = await uploadBlob(new TextEncoder().encode(formJson), { epochs: 5 });
      blobId = result.blobId;
      statuses.upload = 'done';
    } catch (uploadErr) {
      statuses.upload = 'error';
      renderProgressSteps('upload', statuses);
      // Show curl fallback and wait for manual blob ID
      const manualId = await showCurlFallback();
      if (!manualId) { saveBtn.disabled = false; return; }
      blobId = manualId;
      statuses.upload = 'done';
    }

    // Step 3 — Sui TX (includes 0.0005 SUI fee to admin in the same PTB)
    renderProgressSteps('sign', statuses);
    const txResult = await txCreateForm(title, blobId, hashBytes);
    statuses.sign = 'done';

    // Step 4 — extract form object ID from tx effects
    renderProgressSteps('confirm', statuses);
    const formObjectId = extractCreatedObjectId(txResult);
    if (!String(formObjectId).startsWith('0x')) {
      throw new Error('Could not determine created form object ID from transaction response.');
    }
    statuses.confirm = 'done';
    renderProgressSteps('confirm', statuses);

    // Show success modal
    showSuccessModal({ blobId, formObjectId, hashHex });

  } catch (err) {
    window.walformsApp?.showStatusMessage(`Save failed: ${err.message}`, 'error');
    console.error('[builder] save error', err);
  } finally {
    saveBtn.disabled = false;
  }
}

function extractCreatedObjectId(txResult) {
  // Prefer objectChanges so we can reliably pick the WalForm object.
  const createdChanges = txResult?.objectChanges?.filter(c => c.type === 'created') ?? [];
  const walFormChange = createdChanges.find(c =>
    typeof c.objectType === 'string' && c.objectType.endsWith('::registry::WalForm')
  );
  if (walFormChange?.objectId) return walFormChange.objectId;

  // Fallback: effects.created array (wallet-standard response shape)
  const created = txResult?.effects?.created ?? createdChanges;
  for (const obj of created) {
    const id = obj.objectId ?? obj.reference?.objectId;
    if (id) return id;
  }
  // Fallback: return tx digest as stand-in
  return txResult?.digest ?? txResult?.effects?.transactionDigest ?? '(unknown)';
}

function showSuccessModal({ blobId, formObjectId, hashHex }) {
  if (!modal) return;
  const dashboardUrl = `dashboard.html?id=${formObjectId}`;
  const formUrl = `form.html?id=${formObjectId}`;
  const fullUrl = `${location.origin}${location.pathname.replace('builder.html', '')}${formUrl}`;

  if (modalShareUrl) modalShareUrl.value = fullUrl;
  if (modalBlobId)   modalBlobId.textContent = blobId;
  if (modalFormId)   modalFormId.textContent = formObjectId;
  if (modalHash)     modalHash.textContent = hashHex;
  if (modalFormLink) modalFormLink.href = formUrl;
  if (modalDashLink) modalDashLink.href = dashboardUrl;

  modal.hidden = false;
  modal.focus?.();
}

// ---------------------------------------------------------------------------
// Modal events
// ---------------------------------------------------------------------------
function attachModalEvents() {
  modalCopyBtn?.addEventListener('click', () => {
    navigator.clipboard?.writeText(modalShareUrl?.value ?? '').catch(() => {});
    modalCopyBtn.textContent = 'Copied!';
    setTimeout(() => { modalCopyBtn.textContent = 'Copy'; }, 2000);
  });

  modalCloseBtn?.addEventListener('click', () => { modal.hidden = true; clearProgress(); });

  modal?.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal && !modal.hidden) modal.hidden = true;
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function init() {
  buildPalette();
  renderCanvas();
  renderProperties();
  attachCanvasDrop();
  attachModalEvents();

  templateList?.addEventListener('click', e => {
    const btn = e.target.closest('[data-template-id]');
    if (!btn) return;
    const id = btn.getAttribute('data-template-id');
    if (!id) return;
    applyTemplate(id);
  });

  saveBtn?.addEventListener('click', saveForm);
  titleInput?.addEventListener('input', () => titleInput.classList.remove('input-error'));
}

document.addEventListener('DOMContentLoaded', init);

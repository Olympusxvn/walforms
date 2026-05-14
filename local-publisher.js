// local-publisher.js — enable / disable Walrus HTTP publisher on this machine (127.0.0.1).

import {
  getLocalPublisherBaseUrl,
  setLocalPublisherBaseUrl,
  clearLocalPublisherBaseUrl,
} from './walrus.js';

const inputEl = document.getElementById('local-publisher-url');
const statusEl = document.getElementById('local-publisher-status');
const saveBtn = document.getElementById('local-publisher-save');
const clearBtn = document.getElementById('local-publisher-clear');
const testBtn = document.getElementById('local-publisher-test');

function showStatus(msg, type = 'info') {
  if (!statusEl) return;
  if (!msg) {
    statusEl.textContent = '';
    statusEl.hidden = true;
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = msg;
  statusEl.dataset.statusType = type;
}

function loadCurrent() {
  const cur = getLocalPublisherBaseUrl();
  if (inputEl) inputEl.value = cur || 'http://127.0.0.1:31416';
}

saveBtn?.addEventListener('click', () => {
  const raw = inputEl?.value?.trim() ?? '';
  try {
    setLocalPublisherBaseUrl(raw);
    if (!raw) {
      showStatus('Disabled: the app will use only the default mainnet publishers.', 'info');
    } else {
      showStatus(`Saved local publisher: ${getLocalPublisherBaseUrl()}. Reload Builder / Form to apply (or press F5).`, 'info');
    }
    window.dispatchEvent(new CustomEvent('walforms:local-publisher-changed'));
  } catch (e) {
    showStatus(e.message || String(e), 'error');
  }
});

clearBtn?.addEventListener('click', () => {
  clearLocalPublisherBaseUrl();
  loadCurrent();
  showStatus('Local publisher settings cleared.', 'info');
  window.dispatchEvent(new CustomEvent('walforms:local-publisher-changed'));
});

testBtn?.addEventListener('click', async () => {
  const raw = inputEl?.value?.trim() ?? '';
  if (!raw) {
    showStatus('Enter a publisher URL before testing.', 'error');
    return;
  }
  let base;
  try {
    base = raw.replace(/\/+$/, '');
    new URL(base);
  } catch {
    showStatus('Invalid URL.', 'error');
    return;
  }
  showStatus('Calling GET /v1/api…', 'info');
  try {
    const res = await fetch(`${base}/v1/api`, { method: 'GET', cache: 'no-store' });
    if (res.ok) {
      showStatus(`OK — HTTP ${res.status}. Publisher responded (you can save these settings).`, 'info');
    } else {
      showStatus(`HTTP ${res.status}. Check that walrus publisher is running.`, 'error');
    }
  } catch (e) {
    showStatus(
      `Could not connect: ${e.message}. CORS / mixed content: see the warning below; try opening WalForms over http://localhost on the same machine.`,
      'error',
    );
  }
});

document.addEventListener('DOMContentLoaded', () => {
  loadCurrent();
  const cur = getLocalPublisherBaseUrl();
  if (cur) {
    showStatus(`Local publisher enabled: ${cur}`, 'info');
  } else {
    showStatus('', 'info');
  }
});

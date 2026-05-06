// app.js — Shared bootstrap: nav, wallet connect, live ticker, PACKAGE_ID banner.
// Imported by every page via <script type="module" src="app.js">.

import {
  PACKAGE_ID,
  connectWallet,
  disconnectWallet,
  isWalletConnected,
  getConnectedAddress,
  getInstalledWallets,
  getLatestSubmissions,
} from './sui.js';

import { sha256, bytesToHex, merkleRoot } from './crypto.js';

// ---------------------------------------------------------------------------
// Package ID banner — shown when PACKAGE_ID is still the placeholder value
// ---------------------------------------------------------------------------
const PLACEHOLDER_ID = '0x0000000000000000000000000000000000000000000000000000000000000000';

function injectPackageBanner() {
  if (PACKAGE_ID && PACKAGE_ID !== PLACEHOLDER_ID) return;
  const banner = document.createElement('div');
  banner.className = 'package-banner';
  banner.innerHTML = `
    <strong>Configure required:</strong>
    Open <code>sui.js</code> and set <code>PACKAGE_ID</code> to your deployed Move package address,
    then reload.
  `;
  document.body.prepend(banner);
}

// ---------------------------------------------------------------------------
// Wallet state
// ---------------------------------------------------------------------------
const walletState = {
  connected: false,
  address: null,
  walletName: null,
};

function shortAddr(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function updateWalletButton() {
  const btn = document.getElementById('wallet-connect-btn');
  if (!btn) return;

  if (walletState.connected) {
    btn.textContent = shortAddr(walletState.address);
    btn.classList.add('btn--connected');
    btn.title = walletState.address;
  } else {
    btn.textContent = 'Connect wallet';
    btn.classList.remove('btn--connected');
    btn.title = '';
  }

  // Show preview-mode banner if no wallet available and on a page that needs it
  const needsWallet = document.body.dataset.requiresWallet === 'true';
  if (needsWallet && !walletState.connected) {
    showPreviewBanner();
  }
}

function showPreviewBanner() {
  if (document.getElementById('preview-mode-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'preview-mode-banner';
  banner.className = 'preview-banner';
  banner.innerHTML = `
    <strong>Preview mode</strong> — No wallet connected.
    Connect a Sui wallet to create forms, submit responses, or seal a form.
    <span id="preview-dismiss" role="button" tabindex="0" aria-label="Dismiss">✕</span>
  `;
  document.body.prepend(banner);
  document.getElementById('preview-dismiss')?.addEventListener('click', () => banner.remove());
}

async function handleWalletButtonClick() {
  const btn = document.getElementById('wallet-connect-btn');
  if (!btn) return;

  if (walletState.connected) {
    await disconnectWallet();
    walletState.connected = false;
    walletState.address = null;
    walletState.walletName = null;
    updateWalletButton();
    return;
  }

  btn.textContent = 'Connecting…';
  btn.disabled = true;

  try {
    const { address, walletName } = await connectWallet();
    walletState.connected = true;
    walletState.address = address;
    walletState.walletName = walletName;
  } catch (err) {
    const installed = getInstalledWallets();
    if (installed.length === 0) {
      showWalletInstallPrompt();
    } else {
      showStatusMessage(`Wallet connection failed: ${err.message}`, 'error');
    }
  } finally {
    btn.disabled = false;
    updateWalletButton();
  }
}

function showWalletInstallPrompt() {
  const existing = document.getElementById('wallet-install-prompt');
  if (existing) { existing.remove(); }
  const el = document.createElement('div');
  el.id = 'wallet-install-prompt';
  el.className = 'status-banner status-banner--warning';
  el.innerHTML = `
    No Sui wallet detected.
    Install <a href="https://slush.app" target="_blank" rel="noopener">Slush</a>
    or another Wallet Standard-compatible wallet, then reload.
  `;
  const btn = document.getElementById('wallet-connect-btn');
  btn?.insertAdjacentElement('afterend', el);
}

// ---------------------------------------------------------------------------
// Status messages (shared across pages)
// ---------------------------------------------------------------------------
export function showStatusMessage(msg, type = 'info') {
  let banner = document.getElementById('app-status-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'app-status-banner';
    banner.className = 'status-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    const main = document.querySelector('main') ?? document.body;
    main.prepend(banner);
  }
  banner.textContent = msg;
  banner.dataset.statusType = type;
}

export function clearStatusMessage() {
  const banner = document.getElementById('app-status-banner');
  if (banner) banner.remove();
}

// ---------------------------------------------------------------------------
// Live ticker — latest SubmissionRecorded events across all forms
// ---------------------------------------------------------------------------
async function renderLiveTicker() {
  const ticker = document.getElementById('live-ticker');
  if (!ticker) return;

  try {
    const submissions = await getLatestSubmissions(3);
    if (submissions.length === 0) {
      ticker.hidden = true;
      return;
    }

    const items = submissions.map(s => {
      const addr = s.submitter ? shortAddr(s.submitter) : 'anon';
      const formShort = s.formId ? s.formId.slice(0, 8) : '????????';
      return `${addr} submitted to ${formShort}…`;
    });

    ticker.innerHTML = items
      .map(item => `<span class="ticker-item">${item}</span>`)
      .join('<span class="ticker-sep">·</span>');
    ticker.hidden = false;
  } catch {
    // Do not fake — hide the ticker silently if events fail
    ticker.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Active nav link highlighting
// ---------------------------------------------------------------------------
function highlightActiveNav() {
  const path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('nav a[href]').forEach(link => {
    const href = link.getAttribute('href').split('?')[0];
    if (href === path || (path === '' && href === 'index.html')) {
      link.setAttribute('aria-current', 'page');
      link.classList.add('nav-link--active');
    }
  });
}

// ---------------------------------------------------------------------------
// Service worker
// ---------------------------------------------------------------------------
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('service-worker.js');
  } catch {
    // non-fatal
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function initApp() {
  injectPackageBanner();
  highlightActiveNav();
  updateWalletButton();

  const btn = document.getElementById('wallet-connect-btn');
  btn?.addEventListener('click', handleWalletButtonClick);

  // Crypto sanity check (exercises the import)
  const digest = await sha256('walforms:bootstrap');
  console.debug('WalForms bootstrap hash:', bytesToHex(digest));

  await renderLiveTicker();
  await registerServiceWorker();
}

document.addEventListener('DOMContentLoaded', initApp);

// ---------------------------------------------------------------------------
// Global API — used by page-specific scripts
// ---------------------------------------------------------------------------
window.walformsApp = {
  get connected() { return walletState.connected; },
  get address() { return walletState.address; },
  get walletName() { return walletState.walletName; },
  connectWallet: handleWalletButtonClick,
  showStatusMessage,
  clearStatusMessage,
  sha256,
  bytesToHex,
  merkleRoot,
  PACKAGE_ID,
};

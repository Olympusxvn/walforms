// sui.js — Sui mainnet client: wallet connect, TX builders, object queries.
// Uses @mysten/sui SDK + @mysten/wallet-standard via esm.sh CDN. No bundler required.

import { SuiClient, getFullnodeUrl } from 'https://esm.sh/@mysten/sui@1.21.2/client';
import { Transaction } from 'https://esm.sh/@mysten/sui@1.21.2/transactions';

// ---------------------------------------------------------------------------
// Wallet Standard API — using official @mysten/wallet-standard helper
// ---------------------------------------------------------------------------
import { getWallets } from 'https://esm.sh/@mysten/wallet-standard@0.2.0';

const walletsApi = getWallets();
let _wallets = [];
let _wallet = null;

function isSuiWallet(w) {
  return w?.features && (
    'sui:signAndExecuteTransaction' in w.features ||
    'sui:signAndExecuteTransactionBlock' in w.features
  );
}

function addWallet(w) {
  if (w && isSuiWallet(w) && !_wallets.find(x => x.name === w.name)) {
    _wallets.push(w);
  }
}

// Fetch initial wallets
_wallets = walletsApi.get().filter(isSuiWallet);

// Listen for new wallets being registered dynamically
walletsApi.on('register', () => {
  const newWallets = walletsApi.get().filter(isSuiWallet);
  newWallets.forEach(addWallet);
  console.debug('Wallet registry updated:', _wallets.map(w => w.name));
});

// Fallback: retry detecting wallets every 500ms for up to 5 seconds.
// This handles cases where the extension injects late.
let retries = 0;
const maxRetries = 10;
const retryInterval = setInterval(() => {
  const discovered = walletsApi.get().filter(isSuiWallet);
  discovered.forEach(addWallet);

  if (_wallets.length > 0) {
    clearInterval(retryInterval);
    console.debug('✅ Sui wallets detected:', _wallets.map(w => w.name));
  } else if (++retries >= maxRetries) {
    clearInterval(retryInterval);
    console.warn('⚠️ No Sui wallets detected after 5 seconds.');
  }
}, 500);

// Manual event listener fallback for wallet-standard spec
function handleRegisterWalletEvent(event) {
  const register = event?.detail?.register;
  if (typeof register !== 'function') return;

  try {
    register((wallets) => {
      if (Array.isArray(wallets)) {
        wallets.forEach(addWallet);
      } else if (wallets && typeof wallets === 'object') {
        addWallet(wallets);
      }
      return wallets;
    });
  } catch (err) {
    console.warn('Failed to register wallets via event:', err);
  }
}

window.addEventListener('sui:register-wallet', handleRegisterWalletEvent);
window.addEventListener('wallet-standard:register-wallet', handleRegisterWalletEvent);

// Notify wallets that the app is ready
function dispatchAppReady() {
  const detail = { register: (fn) => {
    const wallets = walletsApi.get().filter(isSuiWallet);
    wallets.forEach(w => fn(w));
  }};
  window.dispatchEvent(new CustomEvent('sui:app-ready', {
    bubbles: true,
    cancelable: false,
    detail,
  }));
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', {
    bubbles: true,
    cancelable: false,
    detail,
  }));
}

dispatchAppReady();

// ---------------------------------------------------------------------------
// Config — set after contract deploy
// ---------------------------------------------------------------------------
export const PACKAGE_ID = '0x9c81554f9aa5a2a9bef1acfe5041dd99ed9c6cf4d0668b2d08e2d156aff72c84';
export const ADMIN_CAP_ID = '0x2c3cc866cc9aece966e68aa60472a9551ac780e8c36bd9c8223b6e0c553ff195';
const MODULE = 'registry';
const SUI_RPC = getFullnodeUrl('mainnet');

export const suiClient = new SuiClient({ url: SUI_RPC });

// ---------------------------------------------------------------------------
// Wallet connection state
// ---------------------------------------------------------------------------

export function getConnectedWallet() { return _wallet; }
export function getConnectedAddress() { return _wallet?.accounts?.[0]?.address ?? null; }
export function getAccount() { return _wallet?.accounts?.[0] ?? null; }
export function isWalletConnected() { return Boolean(_wallet && getConnectedAddress()); }

/** Returns currently discovered Sui wallets. Refreshes from API. */
export function getInstalledWallets() {
  const fresh = walletsApi.get().filter(isSuiWallet);
  fresh.forEach(addWallet);
  return [..._wallets];
}

/**
 * Connect to a Sui wallet (prefer Slush if available, otherwise first available).
 * Returns { address, walletName } or throws.
 */
export async function connectWallet(preferredWallet = null) {
  // Refresh wallet list and wait a bit for slow injections
  let wallets = getInstalledWallets();
  if (wallets.length === 0) {
    await new Promise(r => setTimeout(r, 300));
    wallets = getInstalledWallets();
  }

  if (wallets.length === 0) {
    throw new Error(
      'No Sui wallet installed. ' +
      'Please install Slush (https://slush.app) or another Wallet Standard wallet.'
    );
  }

  // Prefer Slush if available, otherwise use preferred or first
  let wallet = preferredWallet
    || wallets.find(w => w.name?.toLowerCase() === 'slush')
    || wallets[0];

  const connectFeature = wallet.features['standard:connect'] ?? wallet.features['sui:connect'];
  if (!connectFeature || typeof connectFeature.connect !== 'function') {
    throw new Error(`Wallet "${wallet.name}" does not support standard:connect.`);
  }

  const result = await connectFeature.connect();
  _wallet = wallet;

  // Some wallets return accounts from connect(), others store on wallet object
  if (result?.accounts?.length) {
    _wallet = { ..._wallet, accounts: result.accounts };
  }

  const address = getConnectedAddress();
  if (!address) {
    throw new Error('Wallet connected but returned no accounts.');
  }

  return { address, walletName: wallet.name };
}

export async function disconnectWallet() {
  if (!_wallet) return;
  const feat = _wallet.features['standard:disconnect'] ?? _wallet.features['sui:disconnect'];
  if (feat && typeof feat.disconnect === 'function') {
    try {
      await feat.disconnect();
    } catch (err) {
      console.warn('Disconnect error (non-fatal):', err);
    }
  }
  _wallet = null;
}

/** Sign and execute a Transaction using the connected wallet. Returns SuiTransactionBlockResponse. */
export async function signAndExecute(tx) {
  if (!_wallet) throw new Error('Wallet not connected.');

  const featureV2 = _wallet.features['sui:signAndExecuteTransaction'];
  const featureV1 = _wallet.features['sui:signAndExecuteTransactionBlock'];

  if (!featureV2 && !featureV1) {
    throw new Error('Wallet does not support signAndExecuteTransaction.');
  }

  const address = getConnectedAddress();
  if (!address) throw new Error('Wallet connected but no address is available.');

  tx.setSender(address);

  if (featureV2 && typeof featureV2.signAndExecuteTransaction === 'function') {
    return await featureV2.signAndExecuteTransaction({
      transaction: tx,
      account: _wallet.accounts[0],
      chain: 'sui:mainnet',
    });
  }

  if (featureV1 && typeof featureV1.signAndExecuteTransactionBlock === 'function') {
    return await featureV1.signAndExecuteTransactionBlock({
      transactionBlock: tx,
      account: _wallet.accounts[0],
      chain: 'sui:mainnet',
    });
  }

  throw new Error('Wallet sign and execute feature is malformed.');
}

export async function signAndExecuteTransaction(tx) {
  return signAndExecute(tx);
}

// ---------------------------------------------------------------------------
// TX Builders
// ---------------------------------------------------------------------------

/**
 * Build + execute create_form TX.
 * @param {string} title
 * @param {Uint8Array|string} definitionBlobId  — Walrus blob ID (bytes or hex string)
 * @param {Uint8Array} definitionHash           — SHA-256 bytes
 */
export async function txCreateForm(title, definitionBlobId, definitionHash) {
  const tx = new Transaction();
  const clock = tx.object('0x6'); // shared Clock object on Sui mainnet
  tx.moveCall({
    target: `${PACKAGE_ID}::${MODULE}::create_form`,
    arguments: [
      tx.pure.vector('u8', encodeString(title)),
      tx.pure.vector('u8', toBytes(definitionBlobId)),
      tx.pure.vector('u8', toBytes(definitionHash)),
      clock,
    ],
  });
  return signAndExecute(tx);
}

/**
 * Build + execute record_submission TX.
 * @param {string} formObjectId   — Sui object ID of the WalForm
 * @param {Uint8Array|string} submissionBlobId
 * @param {Uint8Array} submissionHash
 */
export async function txRecordSubmission(formObjectId, submissionBlobId, submissionHash) {
  const tx = new Transaction();
  const clock = tx.object('0x6');
  tx.moveCall({
    target: `${PACKAGE_ID}::${MODULE}::record_submission`,
    arguments: [
      tx.object(formObjectId),
      tx.pure.vector('u8', toBytes(submissionBlobId)),
      tx.pure.vector('u8', toBytes(submissionHash)),
      clock,
    ],
  });
  return signAndExecute(tx);
}

/**
 * Build a record_submission Transaction WITHOUT executing it.
 * Used by signAndExecuteAnonymous to build the TX separately from signing.
 */
export function buildRecordSubmissionTx(formObjectId, submissionBlobId, submissionHash) {
  const tx = new Transaction();
  const clock = tx.object('0x6');
  tx.moveCall({
    target: `${PACKAGE_ID}::${MODULE}::record_submission`,
    arguments: [
      tx.object(formObjectId),
      tx.pure.vector('u8', toBytes(submissionBlobId)),
      tx.pure.vector('u8', toBytes(submissionHash)),
      clock,
    ],
  });
  return tx;
}

/**
 * Build + execute seal_form TX.
 * @param {string} formObjectId
 * @param {Uint8Array} manifestRoot — Merkle root bytes
 */
export async function txSealForm(formObjectId, manifestRoot) {
  const tx = new Transaction();
  const clock = tx.object('0x6');
  tx.moveCall({
    target: `${PACKAGE_ID}::${MODULE}::seal_form`,
    arguments: [
      tx.object(formObjectId),
      tx.pure.vector('u8', toBytes(manifestRoot)),
      clock,
    ],
  });
  return signAndExecute(tx);
}

// ---------------------------------------------------------------------------
// Object / Event Queries
// ---------------------------------------------------------------------------

/**
 * Fetch a WalForm Sui object by its ID.
 * Returns the parsed fields object or throws.
 */
export async function getWalForm(formObjectId) {
  const obj = await suiClient.getObject({
    id: formObjectId,
    options: { showContent: true, showType: true },
  });
  if (obj.error) throw new Error(`Object ${formObjectId} not found: ${obj.error.code}`);
  const fields = obj.data?.content?.fields;
  if (!fields) throw new Error(`Object ${formObjectId} has no readable fields.`);
  return {
    id: formObjectId,
    title: fields.title,
    creator: fields.creator,
    definitionBlobId: fields.definition_blob_id,
    definitionHash: fields.definition_hash,
    createdAtMs: Number(fields.created_at_ms),
    submissionCount: Number(fields.submission_count),
    finalManifestRoot: fields.final_manifest_root ?? null,
    sealedAtMs: fields.sealed_at_ms ? Number(fields.sealed_at_ms) : null,
    isSealed: Boolean(fields.sealed_at_ms) || Boolean(fields.final_manifest_root),
  };
}

/**
 * Fetch all SubmissionRecorded events for a given form.
 * Returns array of event objects sorted by sequence ascending.
 */
export async function getSubmissionEvents(formObjectId) {
  const results = [];
  let cursor = null;

  do {
    const page = await suiClient.queryEvents({
      query: {
        MoveEventType: `${PACKAGE_ID}::${MODULE}::SubmissionRecorded`,
      },
      cursor,
      limit: 50,
    });

    for (const ev of page.data) {
      const f = ev.parsedJson;
      if (!f) continue;
      if (f.form_id !== formObjectId) continue;
      results.push({
        formId: f.form_id,
        submissionBlobId: f.submission_blob_id,
        submissionHash: f.submission_hash,
        submitter: f.submitter,
        submittedAtMs: Number(f.submitted_at_ms),
        sequence: Number(f.sequence),
        txDigest: ev.id?.txDigest,
      });
    }

    cursor = page.nextCursor ?? null;
    if (!page.hasNextPage) break;
  } while (cursor);

  return results.sort((a, b) => a.sequence - b.sequence);
}

export { getSubmissionEvents as getSubmissionsForForm };

/**
 * Fetch the latest N SubmissionRecorded events across ALL forms.
 * Used for the landing page live ticker.
 */
export async function getLatestSubmissions(limit = 3) {
  try {
    const page = await suiClient.queryEvents({
      query: { MoveEventType: `${PACKAGE_ID}::${MODULE}::SubmissionRecorded` },
      limit,
      order: 'descending',
    });
    return page.data.map(ev => ({
      formId: ev.parsedJson?.form_id,
      submitter: ev.parsedJson?.submitter,
      submittedAtMs: Number(ev.parsedJson?.submitted_at_ms ?? 0),
      sequence: Number(ev.parsedJson?.sequence ?? 0),
      txDigest: ev.id?.txDigest,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Ephemeral keypair for anonymous submissions
// ---------------------------------------------------------------------------

let _ephemeralKeypair = null;

export async function getEphemeralKeypair() {
  if (_ephemeralKeypair) return _ephemeralKeypair;
  const { Ed25519Keypair } = await import('https://esm.sh/@mysten/sui@1.21.2/keypairs/ed25519');
  _ephemeralKeypair = new Ed25519Keypair();
  return _ephemeralKeypair;
}

/**
 * Sign and execute a Transaction using an ephemeral (session-only) keypair.
 * The transaction is sent via the Sui RPC directly (no wallet popup).
 *
 * IMPORTANT: The ephemeral address has no SUI balance. This requires either:
 *   (a) a gas sponsor (tx.setGasOwner) funded externally, or
 *   (b) the caller to have pre-funded the ephemeral address.
 * Without gas, the RPC will reject the TX with InsufficientGas.
 * Connect a wallet to avoid this limitation.
 */
export async function signAndExecuteAnonymous(tx) {
  if (!(tx && typeof tx.setSender === 'function')) {
    throw new Error(
      'signAndExecuteAnonymous requires a Transaction object. ' +
      'Use buildRecordSubmissionTx() to build one.'
    );
  }
  const kp = await getEphemeralKeypair();
  const address = kp.getPublicKey().toSuiAddress();
  tx.setSender(address);
  const bytes = await tx.build({ client: suiClient });
  const { signature } = await kp.signTransaction(bytes);
  return suiClient.executeTransactionBlock({
    transactionBlock: bytes,
    signature,
    options: { showEffects: true, showEvents: true },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function encodeString(str) {
  return Array.from(new TextEncoder().encode(str));
}

export function toBytes(input) {
  if (input instanceof Uint8Array) return Array.from(input);
  if (typeof input === 'string') {
    const clean = input.startsWith('0x') ? input.slice(2) : input;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return Array.from(bytes);
  }
  if (Array.isArray(input)) return input;
  throw new TypeError('toBytes: unsupported input type');
}

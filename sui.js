// sui.js — Sui mainnet client: wallet connect, TX builders, object queries.
// Uses @mysten/sui SDK via esm.sh CDN. No bundler required.

import { SuiClient, getFullnodeUrl } from 'https://esm.sh/@mysten/sui/client';
import { Transaction } from 'https://esm.sh/@mysten/sui/transactions';
import { getWallets } from 'https://esm.sh/@mysten/wallet-standard';

// ---------------------------------------------------------------------------
// Config — set after contract deploy
// ---------------------------------------------------------------------------
export const PACKAGE_ID = '0x9c81554f9aa5a2a9bef1acfe5041dd99ed9c6cf4d0668b2d08e2d156aff72c84';
export const ADMIN_CAP_ID = '0x2c3cc866cc9aece966e68aa60472a9551ac780e8c36bd9c8223b6e0c553ff195';
const MODULE = 'registry';
const SUI_RPC = getFullnodeUrl('mainnet');

export const suiClient = new SuiClient({ url: SUI_RPC });

// ---------------------------------------------------------------------------
// Wallet Standard — connect / disconnect
// ---------------------------------------------------------------------------

let _wallet = null; // active wallet object from wallet-standard

export function getConnectedWallet() { return _wallet; }
export function getConnectedAddress() { return _wallet?.accounts?.[0]?.address ?? null; }
export function isWalletConnected() { return Boolean(_wallet && getConnectedAddress()); }

/** Returns array of installed Sui wallets via wallet-standard. */
export function getInstalledWallets() {
  try {
    // @mysten/wallet-standard getWallets() is the canonical API
    const { get } = getWallets();
    return get().filter(w =>
      w.features &&
      ('sui:signAndExecuteTransaction' in w.features || 'sui:signAndExecuteTransactionBlock' in w.features)
    );
  } catch {
    return [];
  }
}

/**
 * Connect to the first available Sui wallet.
 * Returns { address, walletName } or throws.
 */
export async function connectWallet(preferredWallet = null) {
  const wallets = getInstalledWallets();
  if (wallets.length === 0) {
    throw new Error('No Sui wallet installed. Please install Slush or another Wallet Standard wallet.');
  }
  const wallet = preferredWallet ?? wallets[0];
  const connectFeature = wallet.features['standard:connect'];
  if (!connectFeature) throw new Error('Wallet does not support standard:connect.');
  const result = await connectFeature.connect();
  _wallet = wallet;
  // Some wallets return accounts from connect(), others register them on the wallet object
  if (result?.accounts?.length) _wallet = { ..._wallet, accounts: result.accounts };
  const address = getConnectedAddress();
  if (!address) throw new Error('Wallet connected but returned no accounts.');
  return { address, walletName: wallet.name };
}

export async function disconnectWallet() {
  if (!_wallet) return;
  const feat = _wallet.features['standard:disconnect'];
  if (feat) await feat.disconnect();
  _wallet = null;
}

/** Sign and execute a Transaction using the connected wallet. Returns SuiTransactionBlockResponse. */
export async function signAndExecute(tx) {
  if (!_wallet) throw new Error('Wallet not connected.');
  // Support both wallet-standard v1 (signAndExecuteTransactionBlock) and v2 (signAndExecuteTransaction)
  const feat = _wallet.features['sui:signAndExecuteTransaction']
             ?? _wallet.features['sui:signAndExecuteTransactionBlock'];
  if (!feat) throw new Error('Wallet does not support signAndExecuteTransaction.');
  const address = getConnectedAddress();
  tx.setSender(address);
  const result = await feat.signAndExecuteTransaction({
    transaction: tx,
    account: _wallet.accounts[0],
    chain: 'sui:mainnet',
  });
  return result;
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
    isSealed: Boolean(fields.sealed_at_ms),
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
      // Filter by form_id
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
  const { Ed25519Keypair } = await import('https://esm.sh/@mysten/sui/keypairs/ed25519');
  _ephemeralKeypair = new Ed25519Keypair();
  return _ephemeralKeypair;
}

/**
 * Sign and execute a TX using an ephemeral (session-only) keypair.
 * The transaction is sent via the Sui RPC directly (no wallet popup).
 */
export async function signAndExecuteAnonymous(tx) {
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

function encodeString(str) {
  return Array.from(new TextEncoder().encode(str));
}

function toBytes(input) {
  if (input instanceof Uint8Array) return Array.from(input);
  if (typeof input === 'string') {
    // hex string
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

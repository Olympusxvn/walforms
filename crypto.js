// crypto.js — SHA-256, hex helpers, Merkle root, and Seal hook stub.

export async function sha256(input) {
  const bytes =
    input instanceof ArrayBuffer ? new Uint8Array(input)
    : typeof input === 'string' ? new TextEncoder().encode(input)
    : input;

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function merkleRoot(hashes) {
  if (!Array.isArray(hashes) || hashes.length === 0) {
    return new Uint8Array(32);
  }

  let layer = hashes.map((hash) => hexToBytes(hash));
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] || left;
      const concat = new Uint8Array(left.length + right.length);
      concat.set(left, 0);
      concat.set(right, left.length);
      next.push(await sha256(concat));
    }
    layer = next;
  }

  return layer[0];
}

function hexToBytes(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

// FIXME: Seal integration hook.
// For V1 we support plain blob hashing and Merkle computation.
// Future work: add actual Seal threshold encryption and decryption.
export async function sealBlob(blobData, options = {}) {
  return {
    encrypted: blobData,
    metadata: { seal: 'stub', options },
  };
}

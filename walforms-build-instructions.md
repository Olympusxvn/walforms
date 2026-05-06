# 🟪 WalForms — Claude Code Build Instructions

> **For:** Claude Code (terminal / VS Code)
> **Project:** `walforms`
> **Track:** Walrus Sessions Round 2 — Form Tooling
> **Deadline:** 2026-05-18 (12 days from May 6)
> **Prize pool:** $1,500 WAL + 6× $50 (Best Feedback) + $200 (Special)
> **Deliverable:** Static site deployable via Walgo (HTML/CSS/JS only — no bundler) on Walrus mainnet
> **Submission requirement:** Public repo + demo video <3min uploaded to Walrus + at least 1 real feedback submission via your own tool + Airtable form filled

---

## 🎯 PROJECT THESIS

**Read this whole section before writing any code. The thesis dictates every design decision.**

The brief asks for "a Walrus-native feedback and form platform." 90% of submissions will be **Google Forms clones** that happen to dump JSON into a Walrus blob. That's not Walrus-native — that's S3 with extra steps.

The Walrus team's pitch is: "**A verifiable data platform for high-stakes systems that require provable, programmable, always-available data with no performance tradeoffs.**" If our form tool doesn't make data **provably honest**, it's not built on Walrus's actual differentiator — it's just using the storage.

**WalForms is built around one promise:** **Once a feedback is submitted, the form creator cannot edit, delete, or selectively show it.** Every submission is a Walrus blob anchored on Sui. Every form has an on-chain integrity manifest. Every viewer can independently verify that the submissions shown match the submissions stored. **This is the differentiator.**

This matters because feedback platforms have a fundamental trust problem: the platform owner controls the data. Survey vendors, Notion forms, Typeform — they could silently delete a 1-star review and you'd never know. For a feedback platform that the **Walrus Foundation itself** will use to gather hackathon feedback, this is not abstract — they need the tool to be one they can't be accused of gaming.

**Tagline:** "Forms that can't be gaslit."
**One-liner:** A verifiable feedback platform where every submission is a Walrus blob, every form is a Sui object, and every viewer can independently audit the chain of custody.

---

## 🧱 HARD CONSTRAINTS — READ BEFORE CODING

1. **STATIC SITE ONLY.** Walgo deploys HTML/CSS/JS. No React build, no Next.js, no webpack. Use ES modules + CDN imports (esm.sh). The folder must deploy as-is via `walgo launch`.
2. **All paths RELATIVE.** `href="style.css"` not `/style.css`. Walrus Sites breaks on absolute paths. Same for all internal links.
3. **Walrus MAINNET only.** No testnet references in code, copy, or README.
4. **No localStorage for source-of-truth state.** All form definitions and submissions live on Walrus + Sui. Use IndexedDB only for unsent draft buffering and submission queue retry. This is non-negotiable: if a user clears localStorage, their forms must still exist.
5. **Browser CORS will bite you.** Walrus public publishers may not accept browser PUTs from arbitrary origins. Build a graceful fallback: try direct → try alternate publishers → fall back to a "copy curl command" UI so the user can publish from their CLI. **Do not fake a successful upload.**
6. **Seal encryption is OPTIONAL for V1.** The brief says "optional encryption via Seal for private data." Building Seal threshold encryption into a static site is heavy. **Ship V1 with a clean abstraction layer (`crypto.js`) that supports plain blobs first, with a clearly-documented `// FIXME: Seal integration` hook.** If time permits at the end, add Seal. Do not block V1 on it.
7. **No fake Sui transactions.** When the user has a connected wallet, sign real TXs. When they don't, show a clear "preview mode" banner and let them export a `walrus store` CLI command instead. **Never simulate a checkmark.**

---

## 📁 FILE STRUCTURE

```
walforms/
├── index.html              # Landing — pitch + "Create form" + "Verify a form"
├── builder.html            # Drag-drop form builder
├── form.html               # Public form filler (loads form definition by ID)
├── dashboard.html          # Admin: list submissions, filter, prioritize, export CSV, audit
├── verify.html             # Public auditor: paste form ID, fetch all submissions, verify hashes
├── feedback.html           # Walrus Sessions feedback form (the dogfood — see below)
├── style.css               # Single design system file
├── app.js                  # Shared bootstrap, nav, wallet connect
├── walrus.js               # Walrus client: store/fetch blobs, fallback chain, retry queue
├── sui.js                  # Sui client: register form, register submission, query objects
├── crypto.js               # SHA-256, Merkle root over submission hashes, Seal hook
├── builder.js              # Form builder logic (field types, drag-drop, JSON serialize)
├── form.js                 # Form filler logic, submission flow, optimistic UI
├── dashboard.js            # Submissions list, filter, sort, prioritize, export CSV
├── verify.js               # Public verification flow
├── fields.js               # Field renderers (one place defines all input types)
├── manifest.webmanifest    # PWA basics
├── service-worker.js       # Offline shell cache
├── icon-192.png            # Generate
├── icon-512.png            # Generate
├── move/sources/walforms.move  # Sui Move contract (form registry + submission anchor)
└── README.md
```

---

## 🎨 VISUAL DIRECTION

**Don't reuse OlyTrust's editorial dark theme. Don't reuse Zk-Witness's cyberpunk glitch.** This is a productivity tool — it needs to feel **trustworthy and clean**, not edgy.

**Reference vibe:** Linear × Notion × the OG Stripe dashboard. Restrained. Confident. A little playful where it counts (the "walrus seal" verified animation on the verify page).

**Palette:**
- Background: `#FAF8F5` (warm off-white) for builder/dashboard surfaces
- Deep canvas: `#0F1115` for landing hero
- Walrus violet (brand match): `#8E63FF` primary accent
- Walrus cyan: `#0ED0C8` for verified/integrity states
- Charcoal text: `#1A1B23`
- Muted: `#6B6F7A`
- Hairline border: `#E6E2DA`
- Alert red: `#E04848` (used sparingly for tamper warnings only)

**Typography:**
- Headings: **"Bricolage Grotesque"** (display, weight 600-700, slight optical-size)
- Body: **"Inter"** (400-500-600)
- Mono: **"Geist Mono"** for blob IDs, hashes, Sui addresses

**Visual signatures (the small touches that make it feel premium):**
- A small **walrus mascot SVG seal** that flips from idle to "verified" wave when a form passes integrity check
- Subtle dotted-paper texture on builder canvas (CSS background)
- 8px baseline grid, generous whitespace, no dense data tables (use cards)
- Field type chips in builder use subtle pastel backgrounds (not flat gray)
- Verified badge: cyan pill with a tiny pulse animation, **never green checkmark emoji**

**Anti-patterns to avoid:**
- No glassmorphism (overused)
- No gradient buttons (this is a tool, not a marketing page — except the landing hero CTA)
- No "AI-generated" purple/pink hero gradients
- No emoji in UI chrome (✅ ❌ etc.) — use SVG or text labels

---

## 🧠 THE DATA MODEL (this is the heart of the project)

### Form definition (stored as a Walrus blob)

```json
{
  "schemaVersion": "walforms/v1",
  "id": "abc123-blob-id-on-walrus",
  "title": "Walrus Sessions S2 — Honest Feedback",
  "description": "What worked, what broke, what hurt",
  "createdAt": 1715000000000,
  "creator": "0x...sui-address",
  "fields": [
    { "id": "f1", "type": "shortText", "label": "What were you building?", "required": true },
    { "id": "f2", "type": "longText", "label": "What was the most painful moment?", "required": true },
    { "id": "f3", "type": "rating", "label": "Walgo deploy experience", "scale": 5 },
    { "id": "f4", "type": "checkboxes", "label": "Which docs did you use?", "options": ["docs.wal.app", "GitHub README", "Discord", "AI assistant", "I gave up and asked a friend"] },
    { "id": "f5", "type": "screenshot", "label": "Attach a screenshot of the bug", "required": false },
    { "id": "f6", "type": "video", "label": "Optional 30s loom of your experience", "required": false },
    { "id": "f7", "type": "url", "label": "Your project URL" }
  ],
  "settings": {
    "private": false,
    "allowAnonymous": true,
    "submissionLimit": 0
  }
}
```

The form definition itself is **stored as a Walrus blob** and **registered on Sui** as a `WalForm` object. The form's URL is `form.html?id=<sui-form-object-id>`.

### Submission (stored as a Walrus blob)

```json
{
  "schemaVersion": "walforms/v1",
  "formId": "0x...form-sui-object-id",
  "formBlobHash": "0x...sha256-of-form-definition-blob-at-submit-time",
  "submittedAt": 1715001234000,
  "submitter": "0x...sui-address-or-anon",
  "answers": {
    "f1": "Zk-Witness — citizen evidence capture",
    "f2": "Publisher CORS killed me. Spent 3 hours.",
    "f3": 4,
    "f4": ["docs.wal.app", "Discord"],
    "f5": "<walrus-blob-id-of-screenshot>",
    "f6": null,
    "f7": "https://github.com/Olympusxvn/zk-witness"
  }
}
```

Each submission is uploaded to Walrus as its own blob. The blob ID + a SHA-256 of the full submission JSON + the form ID are written to Sui as a `WalSubmission` event.

### The integrity manifest (the killer feature)

This is what 90% of competitors will skip. **Build this. It is your main differentiator.**

The form creator can call `seal_form(form_id)` after closing submissions. This computes a **Merkle root** over all submission blob IDs (sorted by `submittedAt` ascending) and writes it to the `WalForm` Sui object as `final_manifest_root`. From that moment on:
- The dashboard lists every submission with its Merkle proof
- The public `/verify.html` lets anyone paste a form ID, fetch all submissions, recompute the Merkle root, and confirm it matches the on-chain root
- If the form creator deletes or hides a submission in the UI, the Merkle root no longer matches and the verifier shouts "TAMPERED"

This is what "Walrus-native verifiable feedback" actually means.

---

## 🧩 PAGE-BY-PAGE SPEC

### `index.html` — Landing

Sections, in order:

1. **Hero** (dark canvas, the only dark section in the app)
   - Eyebrow: `WALRUS SESSIONS · ROUND 2`
   - Headline: "Forms that can't be gaslit."
   - Sub: "Every submission is a Walrus blob. Every form is a Sui object. Every viewer can independently audit the chain of custody."
   - Two CTAs: `Create a form` (primary violet) → `builder.html` · `Verify a form` (ghost) → `verify.html`
   - Below CTAs: a tiny live ticker showing the latest 3 submissions across all forms (read from a public Sui event subscription on the `SubmissionRecorded` event), monospace, blob IDs truncated. **If event subscription fails, hide the ticker — do not fake.**

2. **The trust gap** — 3 short cards on light surface
   - "Survey vendors can silently delete bad reviews."
   - "Form data lives in the same DB as the form admin's permissions."
   - "Critics have no way to prove what was submitted vs. what was shown."

3. **How WalForms is different** — split layout
   - Left: animated diagram (CSS only, no canvas heavy stuff): `Form definition → Walrus blob → Sui object · Submission → Walrus blob → Sui event · Anyone → recompute Merkle root → verify`
   - Right: copy explaining the integrity manifest in 4 lines

4. **For Walrus Sessions** — narrative section
   - "Walrus Foundation needs a feedback tool to run future Sessions. Here's why this one works for the case where the Foundation itself is the form admin: the Foundation cannot tamper with submissions, and participants can independently verify that. **WalForms is the only feedback tool a foundation can run on itself without conflict of interest.**"

5. **Try it now** — pointer to `feedback.html` (the dogfood form, see below)

6. **Footer** (see shared footer spec)

### `builder.html` — Form Builder

**Layout:** 3-column. Left = field type palette. Center = canvas (the form preview). Right = field properties.

**Field types (V1):** shortText, longText, rating (1–5 stars), singleChoice, checkboxes, dropdown, screenshot (image upload → Walrus blob), video (≤30s, optional, → Walrus blob), url, confirmationCheckbox.

**Interactions:**
- Drag from palette → drop on canvas to add field
- Reorder fields by drag handle
- Click field → right pane shows label, required toggle, options (for choice types), help text
- "Save form" button:
  1. Serialize JSON form definition
  2. Upload as Walrus blob via `walrus.uploadBlob()`
  3. Sign Sui TX `walforms::create_form(blob_id, title, hash)` and capture form_id
  4. Show success modal with shareable URL: `form.html?id=<form_id>` + copy button
  5. If wallet not connected, show wallet-connect prompt before sign

**Critical UX:** every step shows real progress. Do NOT bundle "uploading + signing" into a single fake spinner. Show:
- `1. Computing hash…` ✓
- `2. Uploading to Walrus…` (with publisher fallback chain visible)
- `3. Awaiting Sui signature in your wallet…`
- `4. Confirmed in epoch X`

If step 2 fails after all publishers exhausted, show the user a `walrus store` CLI command they can paste in their terminal, plus a "I uploaded it manually, here's the Blob ID" fallback input.

### `form.html?id=<form_id>` — Public Form Filler

**Flow:**
1. Read `id` from URL query param
2. Fetch the `WalForm` Sui object → get the form definition Blob ID
3. Fetch the form definition blob from Walrus (with aggregator fallback chain)
4. Verify: SHA-256 the blob, compare to the `definition_hash` field on the Sui object. If mismatch, **refuse to render** and show an "INTEGRITY VIOLATION — form definition does not match on-chain hash" error. This is the user-side verifiability check that makes this tool useful.
5. Render fields using `fields.js`
6. On submit:
   - For each file field (screenshot/video), upload that file to Walrus first → get blob IDs
   - Build submission JSON with the blob IDs in place of the files
   - Compute SHA-256 of the submission JSON
   - Upload submission JSON to Walrus → submission blob ID
   - Sign Sui TX `walforms::record_submission(form_id, sub_blob_id, sub_hash)` to emit `SubmissionRecorded` event
   - Show success page with the user's "submission receipt": their submission blob ID, the Sui TX hash, and a copy-link to a public proof URL
7. If wallet not connected: allow anonymous submission. Sign with a session-only ephemeral keypair. Make this explicit in the UI: "You are submitting anonymously. Your submission is still verifiable, but cannot be tied back to a Sui address."

**Required UX detail:** show the user a checkbox before submit: `"☐ I understand this submission cannot be deleted or edited after submission."` — make this explicit. This is a **feature**, not a bug, and users need to know.

### `dashboard.html?id=<form_id>` — Admin Dashboard

**Auth:** the connected wallet must match the form's `creator` address from the Sui object. Otherwise show "Not authorized — only the form creator can view the admin dashboard."

**Sections:**
1. **Header strip:** form title + total submission count + "Seal form" button (locks the integrity manifest)
2. **Filter bar:** search, sort (newest/oldest/highest-rated), filter by field value, "show flagged only"
3. **Submissions list:** card per submission
   - Submitter (Sui address or "Anonymous")
   - Submitted at (relative time + absolute UTC on hover)
   - Preview of first 2 fields' answers
   - Click expands full submission
   - Each card has: `[ Mark priority ▲ ] [ Add note ] [ Flag ] [ View on Suiscan ↗ ] [ View blob ↗ ]`
4. **Export CSV** button — generates CSV from all current submissions, respects filters
5. **Seal manifest** section (bottom) — when admin clicks "Seal form":
   - Compute Merkle root over all submission blob IDs (sorted by submittedAt asc)
   - Sign Sui TX to write `final_manifest_root` to the WalForm object
   - From that moment, dashboard shows a "✓ Sealed at epoch X — submissions are now publicly verifiable" banner

**Important:** "Mark priority", "notes", and "flagged" status are admin-side metadata. They are NOT stored on Walrus (would defeat the verifiability — admins should be free to triage in private). Store these in a separate IndexedDB keyed by form ID, **and** expose them in the CSV export. Document this clearly in the README and in a small UI tooltip: "Notes are private to you and stored locally in your browser. They are not on-chain."

### `verify.html?id=<form_id>` — Public Auditor

**The killer demo page. Anyone, no wallet needed.**

Flow:
1. Paste a form ID → fetch the WalForm Sui object
2. Fetch the form definition blob → verify hash matches on-chain
3. Fetch all `SubmissionRecorded` events for this form_id from Sui
4. For each event: fetch the submission blob from Walrus → verify SHA-256 matches the on-chain hash → display
5. Compute Merkle root locally
6. Compare to `final_manifest_root` on the WalForm object (if sealed)
7. Show big result panel:
   - `✓ All N submissions verified` (cyan pill, walrus mascot waves) **OR**
   - `✗ TAMPERED — 2 submissions in the dashboard do not match on-chain hashes` (red banner with details)

Also expose: "Download all raw submission blobs as a ZIP" (uses JSZip via CDN).

### `feedback.html` — The Dogfood Form

**This is the form you submit to satisfy the brief's "at least one real feedback submission" requirement.** It is a real WalForms-built form for collecting feedback about Walrus Sessions itself. The hackathon judges fill this out. The team uses it for next session.

Build it as a **regular WalForm** — not a special-cased page. The data flow goes through the same `walrus.js` + `sui.js` as user-created forms. The only difference: `feedback.html` is a hardcoded redirect to `form.html?id=<the-feedback-form-id-Olympus-creates-after-deploy>`.

**Pre-fill the form with the questions from the README's "Questions for Walrus Foundation" section** (see below).

---

## 🧪 MOVE CONTRACT — `move/sources/walforms.move`

```move
module walforms::registry {
    use sui::object::{Self, UID};
    use sui::tx_context::{Self, TxContext};
    use sui::event;
    use sui::clock::{Self, Clock};
    use sui::transfer;
    use std::option::{Self, Option};
    use std::string::{Self, String};

    /// A registered form. Definition lives off-chain on Walrus.
    public struct WalForm has key {
        id: UID,
        title: String,
        creator: address,
        definition_blob_id: vector<u8>,
        definition_hash: vector<u8>,           // SHA-256 of the definition blob
        created_at_ms: u64,
        submission_count: u64,
        final_manifest_root: Option<vector<u8>>,  // Set when sealed
        sealed_at_ms: Option<u64>,
    }

    public struct FormCreated has copy, drop {
        form_id: address,
        creator: address,
        definition_blob_id: vector<u8>,
        title: String,
    }

    public struct SubmissionRecorded has copy, drop {
        form_id: address,
        submission_blob_id: vector<u8>,
        submission_hash: vector<u8>,
        submitter: address,
        submitted_at_ms: u64,
        sequence: u64,                         // 0-indexed within this form
    }

    public struct FormSealed has copy, drop {
        form_id: address,
        manifest_root: vector<u8>,
        submission_count: u64,
        sealed_at_ms: u64,
    }

    /// Create a new form. The form definition lives on Walrus; we anchor its
    /// blob ID + hash here so anyone can verify integrity later.
    public entry fun create_form(
        title: vector<u8>,
        definition_blob_id: vector<u8>,
        definition_hash: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let form = WalForm {
            id: object::new(ctx),
            title: string::utf8(title),
            creator: tx_context::sender(ctx),
            definition_blob_id,
            definition_hash,
            created_at_ms: clock::timestamp_ms(clock),
            submission_count: 0,
            final_manifest_root: option::none(),
            sealed_at_ms: option::none(),
        };
        event::emit(FormCreated {
            form_id: object::uid_to_address(&form.id),
            creator: form.creator,
            definition_blob_id: form.definition_blob_id,
            title: form.title,
        });
        // Shared so anyone can submit; only `creator` can seal.
        transfer::share_object(form);
    }

    /// Record a submission. Anyone can call this; the submission's plaintext
    /// is on Walrus, this just anchors the proof.
    public entry fun record_submission(
        form: &mut WalForm,
        submission_blob_id: vector<u8>,
        submission_hash: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // Refuse if the form is already sealed.
        assert!(option::is_none(&form.final_manifest_root), 0);

        let seq = form.submission_count;
        form.submission_count = seq + 1;

        event::emit(SubmissionRecorded {
            form_id: object::uid_to_address(&form.id),
            submission_blob_id,
            submission_hash,
            submitter: tx_context::sender(ctx),
            submitted_at_ms: clock::timestamp_ms(clock),
            sequence: seq,
        });
    }

    /// Seal the form by writing the Merkle root of all submission hashes.
    /// Only the creator can seal. Once sealed, no further submissions are accepted.
    public entry fun seal_form(
        form: &mut WalForm,
        manifest_root: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(form.creator == tx_context::sender(ctx), 1);
        assert!(option::is_none(&form.final_manifest_root), 2);

        let now = clock::timestamp_ms(clock);
        form.final_manifest_root = option::some(manifest_root);
        form.sealed_at_ms = option::some(now);

        event::emit(FormSealed {
            form_id: object::uid_to_address(&form.id),
            manifest_root,
            submission_count: form.submission_count,
            sealed_at_ms: now,
        });
    }
}
```

**Deployment:** the user (Olympus) deploys this via Slush wallet on Sui mainnet, captures the `PACKAGE_ID`, and pastes it into `sui.js`. Document this in the README. **Do NOT hardcode a placeholder package ID and pretend it works** — show a clear "Configure PACKAGE_ID" banner if it's missing.

---

## 🔌 WALRUS CLIENT (`walrus.js`)

```js
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

export async function uploadBlob(data, { epochs = 5, sendObjectTo = null } = {}) {
  const errors = [];
  for (const base of PUBLISHERS) {
    const url = new URL(`${base}/v1/blobs`);
    url.searchParams.set('epochs', epochs);
    if (sendObjectTo) url.searchParams.set('send_object_to', sendObjectTo);
    try {
      const res = await fetch(url, {
        method: 'PUT',
        body: data,
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
    } catch (e) {
      errors.push(`${base}: ${e.message}`);
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
    } catch (e) {
      errors.push(`${base}: ${e.message}`);
    }
  }
  throw new WalrusFetchError(`Blob ${blobId} not found`, errors);
}

export class WalrusUploadError extends Error {
  constructor(msg, attempts) { super(msg); this.attempts = attempts; }
}
export class WalrusFetchError extends Error {
  constructor(msg, attempts) { super(msg); this.attempts = attempts; }
}

// Generate a curl command the user can run if all publishers fail (CORS, etc.)
export function curlFallback(epochs = 5) {
  return `curl -X PUT "${PUBLISHERS[0]}/v1/blobs?epochs=${epochs}" --upload-file YOUR_FILE`;
}
```

---

## 🔐 CRYPTO LAYER (`crypto.js`)

```js
// SHA-256
export async function sha256(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input)
              : typeof input === 'string' ? new TextEncoder().encode(input)
              : input;
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(buf);
}

export function bytesToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Merkle root over an array of hex-string hashes (sorted-pair construction).
// Empty input -> all-zero root.
export async function merkleRoot(hashes) {
  if (hashes.length === 0) return new Uint8Array(32);
  let layer = hashes.map(h => hexToBytes(h));
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i];
      const b = layer[i + 1] || a;  // duplicate if odd
      const concat = new Uint8Array(a.length + b.length);
      concat.set(a, 0); concat.set(b, a.length);
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

// FIXME: Seal threshold encryption. V2.
// When implemented, will encrypt submission JSON before uploading to Walrus,
// and store the threshold-decrypt config on the WalForm object.
export function isSealAvailable() { return false; }
```

---

## ✅ VALIDATION CHECKLIST (run ALL before finishing)

1. `python3 -c "import html5lib; ..."` — every HTML file parses without errors
2. `node --check <file.js>` — every JS file passes syntax check
3. `grep -rnE 'href="/|src="/' *.html` — must return NOTHING
4. `grep -rin "testnet" *.html *.js *.css` — must return NOTHING in code (README may mention testnet for context)
5. Local smoke: `python3 -m http.server 8080` → open every page → no console errors
6. Mobile viewport 375×667 — no horizontal scroll on any page
7. Wallet-disconnected flow: Verify, public form fill (anonymous), and dashboard "not authorized" all work
8. Walrus publisher down simulation (block fetch in DevTools): builder shows curl fallback and graceful degradation
9. Sui RPC down simulation: verify shows clean error, not stack trace
10. **Manually create one form, submit one response, verify with `verify.html` — confirm Merkle root matches**

---

## 📦 SUBMISSION CHECKLIST (per the hackathon brief)

The brief requires:
- ✅ Public repo on GitHub: `Olympusxvn/walforms`
- ✅ Demo video <3 min uploaded to Walrus (record screen → ffmpeg compress → walrus store → use the resulting blob URL)
- ✅ Short explanation of what you built (paste the README "What is this" section)
- ✅ At least one real feedback submission via your own tool (the `feedback.html` form, filled out by Olympus first, then shared with friends to fill)
- ✅ Register submission on Airtable: https://airtable.com/appoDAKpC74UOqoDa/shrN8UbJRdbkd5Lso

---

## 📄 README REQUIREMENTS

The README must include, in order:

1. **What is this** — 3 sentences, the thesis
2. **Live demo** — placeholder URL, will be filled in after `walgo launch`
3. **Why this is different** — bullet-point comparison vs Google Forms / Typeform / Notion forms
4. **Architecture diagram** — ASCII block diagram of the data flow
5. **Tech stack** — vanilla HTML/CSS/JS, Walrus mainnet, Sui mainnet, Move contract, Walgo
6. **How to run locally** — `python3 -m http.server 8080`, no build step
7. **How to deploy the Move contract** — Slush wallet flow + how to plug in PACKAGE_ID
8. **How to deploy the site** — `walgo launch` walkthrough
9. **Known limitations** — be honest:
   - Seal encryption is V2, not in V1
   - CORS may require user to use a CLI fallback for upload in some configurations
   - Anonymous submissions use ephemeral keys; recovery is not possible
   - File uploads (screenshots/video) are limited to 10 MiB by public publishers
10. **Honest feedback for the Walrus Foundation** — see next section
11. **Credits** — `Crafted with Claude · Directed by @OlympusXVN`
12. **License** — MIT

---

## 💬 HONEST FEEDBACK SECTION (this is where the $50 Best Feedback prize lives)

The brief explicitly rewards "Best feedback regarding building on Walrus" with 6 × $50 WAL prizes. **This is the second prize pool we're targeting.** Build a section in the README and a pre-filled draft in `feedback.html` that the team will read.

**Frame it as a builder's honest debrief, not a complaint list.** The Walrus Foundation needs to hear what hurt, what surprised, and what's missing — not vague praise. Use this template (Claude Code: write this section directly into the README and pre-fill `feedback.html` with these exact questions):

### Questions for Walrus Foundation (pre-filled in feedback form + README)

**On Walgo / deploy experience:**
- The first time I ran `walgo launch`, what was the exact error or friction point?
- Did the deploy work on the first try? If not, where did it fail?
- Did the AI Generate feature in the web UI produce code I could actually ship, or did I have to rewrite it?

**On Walrus HTTP API:**
- Did the public publishers accept browser PUTs from my origin, or did I hit CORS?
- When I needed to upload a 12 MiB file, what was the path forward? (Public publishers cap at 10 MiB.)
- Did the documentation make it clear which mainnet aggregators are reliable?

**On Sui integration:**
- How long did it take to figure out wallet-standard vs zkLogin for a static site?
- Was it obvious that Slush is the canonical mainnet wallet for Walrus Sessions?

**On the Sessions program itself:**
- Was "Form Tooling" specific enough as a brief, or did I find myself building features I wasn't sure would be judged?
- Were the Walrus-native vs Google-Forms-clone differentiators called out clearly enough?
- Would I have built differently if the brief said "the Walrus Foundation will use the winning tool to gather feedback for Session 3"?

**The big one:**
- If the Walrus Foundation deployed WalForms (or any feedback tool) for Session 3, would Foundation members be able to tamper with feedback? **In WalForms's case the answer is no — and that's the point. Most feedback tools fail this test.**

Olympus will fill these in with real answers from his own build experience before submitting. **Claude Code: leave space for that, do not fabricate Olympus's experience.** Write the questions, not the answers.

---

## 🎬 DEMO VIDEO SCRIPT (under 3 minutes — for the submission)

Open the README with this script so Olympus can record cleanly:

**0:00–0:15 — Hook**
"Most feedback tools have a problem: the platform owner can edit, hide, or delete what was submitted. WalForms makes that impossible."

**0:15–0:45 — Build a form**
Open builder. Drag in 4 fields. Click Save. Show the Walrus blob upload, then the Sui signature. Land on the share URL.

**0:45–1:30 — Submit a response**
Open the form URL in a fresh window. Fill it out, attach a screenshot. Click submit. Show the upload pipeline. Land on the receipt page with the submission blob ID and Sui TX.

**1:30–2:15 — The differentiator**
Open verify.html in another fresh window. Paste the form ID. Watch it fetch all submissions, recompute hashes, recompute the Merkle root, and verify against on-chain. Show the cyan "Verified" badge.

**2:15–2:45 — The tamper test**
Go back to the dashboard. (Don't actually tamper — but explain): "If I edited the dashboard's local data to hide a submission, the Merkle root would no longer match. The verifier would catch it."

**2:45–3:00 — Close**
"Forms that can't be gaslit. WalForms. Built for Walrus Sessions Round 2. Repo and live demo in the description."

---

## 🚀 EXECUTION ORDER (build in this sequence)

1. `style.css` + `index.html` — lock the aesthetic and the pitch
2. `walrus.js` + `crypto.js` — get blob round-trip working with no UI
3. `move/sources/walforms.move` — write contract; instruct Olympus to deploy via Slush
4. `sui.js` — wire up form/submission TXs against deployed PACKAGE_ID
5. `builder.html` + `builder.js` + `fields.js` — form creation flow end-to-end
6. `form.html` + `form.js` — public submission flow
7. `verify.html` + `verify.js` — the killer demo page
8. `dashboard.html` + `dashboard.js` — admin view + CSV export + Seal action
9. `feedback.html` — dogfood form for Walrus Sessions feedback
10. `manifest.webmanifest` + `service-worker.js` + icons
11. `README.md` with all sections above
12. Run validation checklist (10 items above)
13. Git init, commit, create GitHub repo, push:
    ```
    gh repo create Olympusxvn/walforms --public --description "Verifiable feedback platform on Walrus + Sui"
    git push -u origin main
    ```
14. Print: GitHub URL, exact next steps (deploy Move via Slush → fill PACKAGE_ID → walgo launch → record demo → submit Airtable), and any TODOs/warnings

---

## ⚠️ IF YOU HIT BLOCKERS

- **Publisher CORS blocks browser uploads:** ship the curl fallback UI. Document in README. Do not fake.
- **No `gh` CLI:** print manual GitHub steps.
- **Move contract too long:** ship the V1 contract as specified above (no Seal, no advanced access control). It is sufficient for the brief.
- **Time runs short:** cut in this order: skip service worker → skip CSV export → skip "Seal form" action (still ship verify with the live computed Merkle, just no on-chain seal). Ship the verify page no matter what — it is the differentiator.

**Start now. Begin with `style.css` and `index.html`.**

# WalForms

> **Forms that can't be gaslit.** Every submission is a permanent Walrus blob, every form has an on-chain Sui integrity manifest, and every viewer can independently verify that nothing was edited or deleted.

## What is this

WalForms is a Walrus-native feedback and form platform where form definitions and submissions are stored as permanent Walrus blobs on Sui mainnet. The form creator cannot delete, edit, or selectively hide submissions â€” verifiability is enforced at the protocol layer. Anyone can open the public auditor, paste a form ID, and confirm the full submission set in under ten seconds.

## Live demo

**URL:** https://walforms-app.netlify.app ; https://olysui.wal.app/

## Architecture
``
## Why this is different

| Feature | WalForms | Google Forms | Typeform | Notion Forms |
|---|---|---|---|---|
| Owner can delete submissions | **No** | Yes | Yes | Yes |
| Owner can edit submissions | **No** | Yes | Yes | Yes |
| Responses stored permanently | **Yes (Walrus)** | No | No | No |
| On-chain integrity manifest | **Yes (Sui)** | No | No | No |
| Anonymous submissions | **Yes** | Partial | No | No |
| Public cryptographic auditor | **Yes** | No | No | No |
| Requires account to respond | **No** | Optional | No | Sometimes |
```
┌─────────────────────────────────────────────────────────────────┐
│              WalForms — Architecture Overview                   │
└─────────────────────────────────────────────────────────────────┘

STATIC FRONTEND (HTML / CSS / JS — deployed via Walgo on Walrus)
┌──────────┐  ┌────────────┐  ┌───────────┐  ┌──────────┐
│ builder  │  │    form    │  │ dashboard │  │  verify  │
│  .html   │  │   .html    │  │   .html   │  │  .html   │
└────┬─────┘  └─────┬──────┘  └─────┬─────┘  └────┬─────┘
     │               │               │               │
     └───────────────┴───────────────┴───────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         walrus.js       sui.js        crypto.js
              │              │              │
    PUT /v1/blobs       sign TX        SHA-256 hash
    GET /v1/blobs/{id}  via wallet     Merkle root
              │              │
    ┌─────────▼──┐    ┌──────▼──────────────────────────┐
    │   Walrus   │    │         Sui mainnet              │
    │  mainnet   │    │                                  │
    │            │    │  walforms::registry              │
    │ publisher  │    │  ┌────────────────────────────┐  │
    │ (fallback  │    │  │ WalForm (shared object)    │  │
    │  chain +   │    │  │  creator: address          │  │
    │  curl UI)  │    │  │  title: String             │  │
    │            │    │  │  definition_blob_id: bytes  │  │
    │ aggregator │    │  │  definition_hash: bytes     │  │
    │ (fallback  │    │  │  submission_count: u64      │  │
    │  chain)    │    │  │  final_manifest_root: ?bytes│  │
    └────────────┘    │  └────────────────────────────┘  │
                      │                                  │
                      │  Events (NOT stored in object):  │
                      │  · FormCreated                   │
                      │  · SubmissionRecorded            │
                      │    (blob_id, hash, seq, time)    │
                      │  · FormSealed                    │
                      └──────────────────────────────────┘

OFF-CHAIN (local browser only — NOT on Walrus, NOT on Sui):
  IndexedDB: priority flags, admin notes, unsent submission queue
  Never exposed in public verify — clearly documented in README

DATA FLOW — Create Form:
  builder → serialize JSON → sha256 (crypto.js)
          → PUT Walrus (walrus.js) → blobId
          → sign create_form(title, blobId, hash) (sui.js)
          → share URL: form.html?id=<WalForm-object-id>

DATA FLOW — Submit Response:
  form.html → serialize answers → sha256 (crypto.js)
            → PUT Walrus (walrus.js) → subBlobId
            → sign record_submission(formId, subBlobId, hash) (sui.js)
            → emits SubmissionRecorded event (NOT stored in WalForm array)
            → receipt: subBlobId + Sui TX

DATA FLOW — Verify:
  verify.html → fetch WalForm object (sui.js)
              → fetch all SubmissionRecorded events for formId (sui.js)
              → for each event: fetch blob (walrus.js) → sha256 (crypto.js)
                                compare to event.submission_hash
              → compute Merkle root (crypto.js) over all hashes
              → compare to WalForm.final_manifest_root
              → ✓ VERIFIED or ✗ TAMPERED
```

## Tech stack

- **Frontend:** Vanilla HTML / CSS / ES modules (no bundler, no framework)
- **Storage:** Walrus mainnet blobs (publisher + aggregator public endpoints)
- **Chain:** Sui mainnet Move contract + `@mysten/sui` SDK via esm.sh CDN
- **Wallet:** wallet-standard (Slush, Suiet, etc.)
- **PWA:** `manifest.webmanifest` + `service-worker.js` offline shell cache
- **Deploy:** `walgo launch` (static site to Walrus)

## How to run locally

No build step. Serve the directory over HTTP (required for ES modules + service worker):

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

Or use any static server (`npx serve`, VS Code Live Server, etc.).

## How to deploy the Move contract

1. Install Sui CLI and ensure mainnet RPC is configured.
2. Import your deployer wallet: `sui keytool import <MNEMONIC> ed25519`
3. From the `move/` directory: `sui client publish --gas-budget 100000000`
4. Copy the `PackageID` from the output.
5. Open `sui.js` and set `PACKAGE_ID` to the copied value.

The site shows a **"Configure PACKAGE_ID"** banner until the real value is set.

## How to deploy the site

```sh
# Install walgo if not present
npm install -g @walrus-labs/walgo

# From the walforms/ directory
walgo launch
```

Walgo publishes all static assets to Walrus and returns a permanent URL.

## Known limitations

- **Seal encryption (Seal V2):** The integrity manifest uses on-chain Merkle root verification only. Encryption of individual submissions via Seal is a V2 feature â€” not implemented in this release.
- **CORS on browser uploads:** Public Walrus publishers may reject browser PUT requests from some origins. The UI shows a curl fallback command when this happens â€” do not paste fake success.
- **Anonymous submissions:** Anonymous respondents get an ephemeral keypair generated in the browser. If they clear their browser data, the keypair is lost. Recovery is not possible.
- **File upload size:** Screenshots and video attachments are limited to ~10 MiB by the public publishers. Larger files require a private publisher endpoint.

## Mainnet publisher HTTP reliability (502 / integration)

WalForms calls **`PUT /v1/blobs`** on Mainnet publisher endpoints. Walrus docs correctly note [no formal SLA on public infrastructure](https://docs.wal.app/docs/system-overview/system-constraints#public-infrastructure-availability) and that [Mainnet publishers differ from Testnet](https://docs.wal.app/docs/system-overview/public-aggregators-and-publishers). Even so, **opaque 502** responses and unclear integration paths cost every integrator time.

We wrote a **constructive change request** for publisher operators and ecosystem documentation — observability, HTTP semantics, structured errors, `operators.json` parity, and success criteria:

**→ [change_request.md](change_request.md)**

User-facing incident summary and mitigations: **[walrus-mainnet-publisher-502-report.html](walrus-mainnet-publisher-502-report.html)**.

## Honest feedback for the Walrus Foundation

*(Olympus: fill in your real answers below before submitting. Questions are pre-filled in `feedback.html` too.)*

### On Walgo / deploy experience

- The first time you ran `walgo launch`, what was the exact error or friction point?
- Did the deploy work on the first try? If not, where did it fail?
- Did the AI Generate feature in the web UI produce code you could actually ship, or did you rewrite it?

### On Walrus HTTP API

- Did the public publishers accept browser PUTs from your origin, or did you hit CORS?
- When you needed to upload a file over 10 MiB, what was the path forward?
- Did the documentation make it clear which mainnet aggregators are reliable?

### On Sui integration

- How long did it take to figure out wallet-standard vs zkLogin for a static site?
- Was it obvious that Slush is the canonical mainnet wallet for Walrus Sessions?

### On the Sessions program itself

- Was "Form Tooling" specific enough as a brief, or did you find yourself building features you weren't sure would be judged?
- Were the Walrus-native vs Google-Forms-clone differentiators called out clearly enough in the brief?
- Would you have built differently if the brief said "the Walrus Foundation will use the winning tool to gather feedback for Session 3"?

### The big one

If the Walrus Foundation deployed WalForms (or any feedback tool) for Session 3, would Foundation members be able to tamper with the feedback?

**In WalForms's case the answer is no â€” and that's the point. Most feedback tools fail this test.**

## Demo video script (< 3 min)

**Hook**
"Most feedback tools have a problem: the platform owner can edit, hide, or delete what was submitted. WalForms makes that impossible."

**Build a form**
Open `builder.html`. Drag in 4 fields. Click Save. Show the Walrus blob upload pipeline, then the Sui wallet signature. Land on the share URL.

**Submit a response**
Open the form URL in a fresh window. Fill it out, attach a screenshot. Click submit. Show the upload pipeline. Land on the receipt with the submission blob ID and Sui TX.

**The differentiator**
Open `verify.html` in another fresh window. Paste the form ID. Watch it fetch all submissions, recompute hashes and the Merkle root, then compare to on-chain. Show the cyan **Verified** badge.

**The tamper test**
Describe what happens if someone tries to delete or alter a submission: the Merkle root no longer matches. The verifier turns red. The record is on Walrus forever.

**CTA**
"Open the form, fill it out, share the link. It can't be taken down."

## Credits

Crafted with Claude· Directed by @OlympusXVN

## License

MIT


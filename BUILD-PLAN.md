# WalForms Build Plan

**Project:** WalForms — Walrus-native verifiable feedback platform  
**Tagline:** "Forms that can't be gaslit."  
**Deadline:** 2026-05-18  
**Stack:** Static HTML/CSS/JS (no bundler), Walrus mainnet, Sui mainnet, Move contract, Walgo deploy  
**Repo:** `C:\Users\Admin\walforms`

## ✅ DONE
- [x] Task 1: `style.css` + `index.html` (commit `2f2a306`)

## ⏳ REMAINING TASKS

### Task 2: `walrus.js` + `crypto.js`
Walrus mainnet HTTP client with publisher/aggregator fallback chain, curl fallback UI, retry queue.
Crypto: SHA-256 (Web Crypto API), bytesToHex, Merkle root, Seal hook stub.

Full implementation in build instructions (walforms-build-instructions.md).

### Task 3: `move/sources/walforms.move`
Sui Move contract: WalForm object, create_form / record_submission / seal_form entry functions,
FormCreated / SubmissionRecorded / FormSealed events. Also write Move.toml.

### Task 4: `sui.js` + `app.js`
Sui wallet connect (@mysten/wallet-standard via CDN), form/submission TX builders,
shared nav/bootstrap, live ticker (SubmissionRecorded events), PACKAGE_ID config banner.

### Task 5: `builder.html` + `builder.js` + `fields.js`
3-column form builder (palette / canvas / properties panel).
Field types: shortText, longText, rating, singleChoice, checkboxes, dropdown, screenshot, video, url, confirmationCheckbox.
Save form: hash → Walrus upload (step-by-step real progress UI) → Sui TX → share modal.

### Task 6: `form.html` + `form.js`
Public form filler. Load form by Sui object ID → verify definition hash → render fields → submit:
upload files → build submission JSON → SHA-256 → Walrus upload → Sui TX → receipt page.
Anonymous ephemeral key support. "Cannot be deleted" checkbox before submit.

### Task 7: `verify.html` + `verify.js`
Public auditor. No wallet needed. Paste form ID → fetch WalForm → verify definition hash →
fetch all SubmissionRecorded events → verify each blob SHA-256 → compute Merkle root →
compare to on-chain final_manifest_root → show cyan verified or red TAMPERED banner.
JSZip download-all-blobs button.

### Task 8: `dashboard.html` + `dashboard.js`
Auth-gated admin view (wallet must match form creator).
Submissions list with filter/sort/search, mark priority/flag/notes (IndexedDB private),
CSV export, Seal form button (Merkle root → Sui TX).

### Task 9: `feedback.html` + PWA + `README.md`
feedback.html: redirect to feedback form (hardcoded form ID placeholder).
manifest.webmanifest, service-worker.js (offline shell cache), icon-192.png + icon-512.png (generated).
README with all required sections: thesis, live demo, architecture, tech stack, deploy guide,
honest feedback questions, demo video script, MIT license.

### Task 10: Validation + GitHub push
Run all 10 validation checks from build instructions.
Push to GitHub: `gh repo create Olympusxvn/walforms --public`.

## KEY REFERENCES
- Full spec: `walforms-build-instructions.md` (read this before each task)
- Walrus publishers: https://publisher.walrus.space, https://publisher.walrus-mainnet.walrus.space
- Walrus aggregators: https://aggregator.walrus.space, https://aggregator.walrus-mainnet.walrus.space
- Sui SDK CDN: https://esm.sh/@mysten/sui
- JSZip CDN: https://esm.sh/jszip

## HARD CONSTRAINTS (enforce on every file)
1. Static site ONLY — no React, no webpack, no bundler
2. ALL paths relative (`href="style.css"` not `/style.css`)
3. Walrus MAINNET only — no testnet
4. No localStorage for source-of-truth — IndexedDB for drafts/queue only
5. No fake uploads — show real errors + curl fallback
6. No fake Sui TXs — show real wallet prompts or preview mode banner

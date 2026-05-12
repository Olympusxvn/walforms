# Changelog

## [Unreleased] — 2026-05-07

### Added

- **fields.js — new question types in builder/form canvas**
  Added `email`, `phone`, `number`, `date`, and `time` field types to the palette and wired
  them through `renderFieldInput` and `readFieldValue` so they render and submit correctly.

- **builder.html / builder.js — form templates (with thumbnails)**
  Added a “Form templates” section in the builder sidebar with 3 starter presets
  (Website feedback / Customer survey / Travel request). Template buttons show thumbnails
  and apply a simple default title + field list you can customize.

- **builder.html / builder.js — admin dashboard shortcut after save**
  Added an `Open admin dashboard` button in the success modal and linked it to
  `dashboard.html?id=<formObjectId>`.

- **dashboard.js / dashboard.html — professional admin UX polish**
  Added access badges (`Access as Creator` / `Access as Admin`), manual refresh, auto-refresh
  every 30s (when tab is active), and last-sync status for smoother dashboard operations.

- **tests/dashboard-auth.smoke.spec.js — Playwright smoke E2E for admin auth**
  Added Chromium smoke tests for three key paths: creator access, admin-cap access, and blocked
  access for non-admin/non-creator wallets.

- **myfeedback.html — shareable respondent entry for Walrus Sessions**
  Landing page that redirects to `form.html?id=…` when a WalForm object ID is present (`?id=` /
  `?form=` or inline preset), or prompts for an ID after publishing from the builder.

- **walrus-mainnet-publisher-502-report.html — canonical Mainnet publisher incident page**
  Single HTML reference covering: HTTP **502** / DNS **(6)** / PowerShell **`curl` vs `curl.exe`**,
  copy-paste letter to operators, ranked mitigations (production docs, **local `walrus publisher`**
  + `curl.exe`, **testnet** sanity check with network caveat), what WalForms implements (retries,
  manual blob ID), Sessions/hackathon framing, and a README blurb. Supersedes scattered notes.

- **index.html — Sessions navigation**
  Linked **Sessions feedback** (`myfeedback.html`) and **Publisher 502 report**
  (`walrus-mainnet-publisher-502-report.html`) from the nav, hero, “Try it live” CTA, and footer;
  fixed footer GitHub href to the public repository.

### Changed

- **builder.js / form.js — alternate publisher in curl fallback UI**
  When multiple publisher base URLs are configured, the Walrus failure panel shows a primary and
  **alternate** `curl` / `curl.exe` command (helps when the first host fails DNS).

### Removed

- **docs/walrus-mainnet-publisher-502-report.md**
  Removed to avoid drift; all operator/issue content lives in
  **`walrus-mainnet-publisher-502-report.html`** only.

### Documentation

- **change_request.md — Mainnet publisher HTTP reliability**
  Constructive technical proposal for publisher operators and ecosystem docs: health/readiness,
  HTTP semantics (503 vs 502, Retry-After), structured errors, monitoring, `operators.json` parity,
  integration decision tree — with cited Walrus docs and measurable success criteria. Linked from
  **README.md** next to **walrus-mainnet-publisher-502-report.html**.

### Fixed

#### Critical

- **walrus.js — Walrus publisher / aggregator hostnames**
  Dropped legacy `publisher.walrus.space` / `aggregator.walrus.space`. The Mysten-style publisher
  hostname `publisher.walrus-mainnet.walrus.space` **does not exist in public DNS** (NXDOMAIN), so
  `curl`/`curl.exe` cannot resolve it — use operator-listed HTTP publishers instead. Upload fallbacks
  now target `walrus-mainnet-publisher-1.staketab.org` first, then
  `publisher.walrus-mainnet.h2o-nodes.com`. Aggregator reads still use
  `aggregator.walrus-mainnet.walrus.space` (resolves) plus Staketab.

- **walrus.js — browser upload compatibility improved for Netlify/CORS scenarios**
  Removed explicit `Content-Type` on browser `PUT` upload to reduce CORS preflight failures on
  public publisher endpoints. Also expanded blob ID parsing to support multiple response shapes
  (`blobId`, `blob_id`, nested variants).

- **builder.js — curl fallback when Walrus publishers fail**
  When browser upload fails (e.g. CORS/publisher rejection), the builder shows a terminal `curl`
  command to upload `form-definition.json` manually and then asks you to paste the resulting
  Walrus Blob ID to continue the Sui `create_form` flow.

- **builder.js / form.js — why the manual terminal `PUT` exists (`curl` / `curl.exe`)**
  The Walrus step must produce a **blob ID** that Sui stores on-chain when creating or updating a
  form. When the in-page upload fails, the definition (or submission JSON) never reaches the
  publisher, so there is no blob ID to sign against. Running **`curl` (or `curl.exe` on Windows)
  from your own terminal** sends the file with a direct HTTP `PUT` to the Walrus publisher API,
  outside the browser’s origin and CORS rules—so you can still obtain a blob ID and paste it back
  to finish the wallet flow. On **Windows PowerShell**, `curl` is an alias for
  `Invoke-WebRequest`, which does not support `-X` / `--upload-file` like real curl; the UI shows
  a **`curl.exe …`** copy of the same command for that environment.

- **builder.js / sui.js — reliable `formObjectId` extraction after `create_form`**
  Builder now requests `showObjectChanges` in wallet execution options and explicitly picks the
  created `::registry::WalForm` object from transaction changes instead of using the first
  created object. This prevents wrong IDs that could break form/dashboard links.

- **dashboard.js / dashboard.html / sui.js — admin-cap aware dashboard authorization**
  Dashboard access now matches on-chain policy: allow either form creator or addresses listed in
  shared `AdminCap.admins` (loaded via `ADMIN_CAP_ID`). The old creator-only check is removed.

- **app.js / sui.js — connect/disconnect wallet flow hardened**
  Wallet button now acts as a connect/disconnect toggle, and disconnect clears both local wallet
  and account state while attempting provider disconnect across discovered wallets.

- **sui.js — duplicate declaration block removed**
  Lines 432–716 were a verbatim re-declaration of every exported function and constant. In
  strict ES module scope this caused a parse-time `SyntaxError: Identifier already declared`,
  preventing the entire application from loading. The duplicate block has been removed.

- **form.js — anonymous TX now builds a real `Transaction` object**
  `buildRecordTx` previously returned a plain object `{ formObjectId, subBlobId, hashBytes }`.
  `signAndExecuteAnonymous` called `.setSender()` on it, throwing a runtime
  `TypeError: tx.setSender is not a function` on every anonymous submission.
  `buildRecordTx` has been replaced with a call to the new `buildRecordSubmissionTx` export
  from `sui.js`, which returns a fully constructed `Transaction` instance.

- **sui.js — `signAndExecuteAnonymous` validates its argument**
  Added a type-guard that throws a descriptive error if the caller passes a non-`Transaction`
  argument, surfacing the root cause immediately instead of a cryptic `setSender` crash.

#### Improved

- **walrus.js — retry transient gateway errors on blob upload**
  `uploadBlob` retries each publisher up to 3 times with backoff when the HTTP response is
  **502 / 503 / 504**, before falling through to the next publisher. This only helps **short**
  outages; sustained **502** from Mainnet publishers still requires operator fixes, authenticated
  publishers, or self-hosted infrastructure per Walrus docs.

- **sui.js — `isSealed` now checks both `sealed_at_ms` and `final_manifest_root`**
  The frontend sealed-state check now mirrors the on-chain guard in `walforms.move`, which
  tests `option::is_none(&form.final_manifest_root)`. Previously only `sealed_at_ms` was
  checked, creating a potential inconsistency.

- **sui.js — `buildRecordSubmissionTx` exported as a standalone helper**
  Extracted the Transaction-building logic for `record_submission` into a named export so
  callers can build the TX without executing it (used by the anonymous submission path).

- **sui.js — `encodeString` and `toBytes` are now named exports**
  These were previously internal-only; exporting them allows other modules to reuse them
  without copy-pasting.

### Process summary — Walrus Mainnet HTTP publishers (Sessions track)

Chronological arc of the Mainnet upload workstream (browser + CLI), for reviewers and future us:

1. **PowerShell confusion** — Users hit `Invoke-WebRequest` when typing `curl -X …`; builder and
   form fallbacks now show **`curl.exe`** alongside GNU `curl`, with a short explanation.
2. **DNS** — Legacy hostnames (`publisher.walrus.space`, later `publisher.walrus-mainnet.walrus.space`)
   failed resolution (**NXDOMAIN**); publisher lists were pointed at operator-style bases that resolve
   in public DNS (e.g. Staketab, H2O).
3. **502 Bad Gateway** — Community Mainnet publisher endpoints returned sustained **502** from both
   `fetch` and **`curl.exe`**; consistent with Walrus docs (no SLA on public infra; Mainnet has no
   unauthenticated public publishers). Response: **retry 502/503/504** in `uploadBlob`, document the
   issue for operators, and keep **manual blob ID** continuation so creators can finish `create_form`
   when HTTP upload fails.
4. **Site + submission story** — Added **myfeedback.html**, linked everything from **index.html**,
   and consolidated reporting into **walrus-mainnet-publisher-502-report.html** (local publisher +
   testnet examples, README blurb, Sessions framing when HTTP stays unreliable).
5. **Outcome** — The app remains honest about infrastructure limits while preserving a complete
   builder → wallet → Sui path via fallbacks; production-grade Mainnet uploads still point toward
   **authenticated publishers**, **CLI**, or **self-hosted** publisher per official docs.

### Known Limitations

- **Anonymous on-chain submission requires gas** — the ephemeral Ed25519 keypair generated
  per session has no SUI balance. Without a gas sponsorship flow the RPC will reject the TX
  with `InsufficientGas`. Users should connect a wallet when possible. A proper fix requires
  either a server-side gas station or zkLogin.

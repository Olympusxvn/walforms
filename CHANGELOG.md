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

### Fixed

#### Critical

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

### Known Limitations

- **Anonymous on-chain submission requires gas** — the ephemeral Ed25519 keypair generated
  per session has no SUI balance. Without a gas sponsorship flow the RPC will reject the TX
  with `InsufficientGas`. Users should connect a wallet when possible. A proper fix requires
  either a server-side gas station or zkLogin.

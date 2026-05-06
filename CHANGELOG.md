# Changelog

## [Unreleased] — 2026-05-07

### Fixed

#### Critical

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

# Contributing — OlympusXVN & Cursor Agent

This repository is maintained through collaboration between **OlympusXVN** (product owner, architecture decisions, and submission narrative for Walrus Sessions) and the **Cursor Agent** (implementation, refactors, commits, and automated verification within the workspace).

The sections below describe how that collaboration works so future sessions stay consistent.

---

## Roles

| | **OlympusXVN** | **Cursor Agent** |
|---|----------------|------------------|
| **Owns** | Goals, hackathon brief interpretation, what ships vs what is documented-only, final wording for judges/foundation | Executing edits in-repo, running commands, proposing concrete diffs aligned with existing patterns |
| **Provides** | Constraints (“minimal diff”, “don’t touch unrelated files”, Vietnamese vs English audience), links to external feedback (operators, docs) | Reads `CHANGELOG.md`, `change_request.md`, and source files before changing behavior |

Neither role replaces the other: the Agent does not decide hackathon strategy alone; OlympusXVN does not need to hand-type every file change when delegation is explicit.

---

## Workflow expectations

1. **Instructions** — OlympusXVN states intent in natural language (often bilingual). The Agent assumes continuity from recent turns unless told otherwise.
2. **Scope** — Prefer **focused changes**: one concern per commit when practical. Avoid drive-by refactors and unsolicited new markdown unless requested.
3. **Evidence** — For infrastructure claims (Walrus publishers, Sui RPC), prefer **official docs URLs** and reproducible observations over speculation.
4. **Commits** — The Agent may commit and push when OlympusXVN asks for “commit only” or “commit and push”; commit messages use clear English imperatives (`feat:`, `fix:`, `docs:`).

---

## Project conventions (from practice)

- **Frontend:** Vanilla ES modules, `style.css` design tokens — match surrounding code style when editing `walrus.js`, `sui.js`, `builder.js`, `form.js`.
- **Walrus / Mainnet:** Treat **authenticated publisher** and **no SLA on public infra** as first-class constraints; document honestly in `CHANGELOG.md` and `change_request.md` when behavior or policy is clarified.
- **CHANGELOG:** Substantive user-visible or reviewer-relevant documentation and stance updates go under **`[Unreleased]`** with dated context when useful.

---

## What not to assume

- Do not assume **unauthenticated** Mainnet `PUT` parity with Testnet — ecosystem feedback and Walrus docs converge on **auth** for Mainnet publishers.
- Do not assume a **localhost-only** publisher replaces a **shareable deployed app** for Sessions-style demos; see `change_request.md` hackathon subsection.

---

## Contact

**OlympusXVN** — repository owner; directed-by credit in README.

**Cursor Agent** — ephemeral per session; continuity via git history, `CHANGELOG.md`, and this file.

---

*WalForms · Walrus Sessions*

# Mainnet Walrus HTTP publisher — 502 Bad Gateway on `PUT /v1/blobs`

Use this document as an **email**, **GitHub issue**, or **Discord** message to Walrus publisher operators or Mysten support.

---

**Subject:** Mainnet Walrus HTTP publisher — 502 Bad Gateway on `PUT /v1/blobs`

Hello,

We operate **[WalForms](https://github.com/Olympusxvn/walforms)** — a Walrus-native form platform on **Sui Mainnet**. End users upload JSON definitions and submissions via the standard Walrus publisher HTTP API:

`PUT {publisher}/v1/blobs?epochs=5` with the raw body (`application/octet-stream` / file bytes).

## Observed behavior

We consistently receive **HTTP 502 Bad Gateway** when calling community Mainnet publisher endpoints from browsers (`fetch`) and from **Windows** terminals (**`curl.exe`**, not PowerShell’s `curl` alias):

| Endpoint | Result |
|----------|--------|
| `https://walrus-mainnet-publisher-1.staketab.org/v1/blobs?...` | **502** (short body: “error code: 502”) |
| `https://publisher.walrus-mainnet.h2o-nodes.com/v1/blobs?...` | **502** (nginx HTML “502 Bad Gateway”) |

For comparison, the same **`PUT`** pattern against a **Testnet** publisher (e.g. `https://publisher.walrus-testnet.walrus.space/...`) returns **200** and a valid blob ID, so our client request shape and network path appear sound.

## Context from Walrus docs

- [Public aggregators and publishers](https://docs.wal.app/docs/system-overview/public-aggregators-and-publishers) states that on Mainnet there are **no public publishers without authentication**, as they consume **SUI** and **WAL**.
- [System constraints — public infrastructure](https://docs.wal.app/docs/system-overview/system-constraints#public-infrastructure-availability) notes that public publishers have **no formal availability guarantees**.

We are trying to understand whether:

1. These Mainnet HTTP publisher URLs are **expected** to accept **unauthenticated** `PUT` uploads today, or whether production integrations must use an [**authenticated publisher**](https://docs.wal.app/docs/operator-guide/publishers/auth-publisher) / **CLI** / **self-hosted** publisher only.
2. The **502** responses indicate a **known outage**, misconfiguration, or upstream Walrus node issue on your side — and if there is a **status channel** or **ETA** for restoration.
3. There is a **canonical list** of Mainnet publisher base URLs suitable for app integrations (the JSON at [`operators.json`](https://docs.wal.app/operators.json) documents **aggregators** extensively; **publishers** appear primarily under **testnet** in that file).

## What would help us

- Confirmation of the **supported** integration path for Mainnet blob uploads for third-party apps (HTTP vs CLI vs authenticated publisher).
- If **502** is unintended: any tracking ID, timeline, or workaround you recommend until the service is healthy.

Thank you for your time.

— **[Your name / team]**  
**Project:** WalForms — Walrus Sessions  

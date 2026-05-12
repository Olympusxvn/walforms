# Change request: Mainnet Walrus HTTP publisher reliability

**Audience:** Teams operating **Walrus publisher** HTTP endpoints on **Sui Mainnet**, and maintainers of **Walrus operator listings / documentation**.  
**Origin:** [WalForms](https://github.com/Olympusxvn/walforms) — a production-style static app that uploads form definitions and submissions via **`PUT /v1/blobs`** ([Storing blobs — HTTP API](https://docs.wal.app/docs/http-api/storing-blobs)).  
**Companion:** Incident narrative and user mitigations live in [`walrus-mainnet-publisher-502-report.html`](walrus-mainnet-publisher-502-report.html).

---

## Why this document exists

Mainnet is where real feedback tools must land for Sessions and for teams who anchor integrity on **Sui mainnet**. Today, integrators hit two classes of failure:

1. **HTTP 502 Bad Gateway** from reverse proxies in front of publisher daemons — the browser or CLI reaches the edge, but the edge cannot obtain a successful response from the upstream Walrus publisher process.
2. **Operational ambiguity** — Walrus documentation correctly states that [public publishers have no formal availability guarantees](https://docs.wal.app/docs/system-overview/system-constraints#public-infrastructure-availability) and that [Mainnet has no unauthenticated “public publishers” in the same sense as Testnet](https://docs.wal.app/docs/system-overview/public-aggregators-and-publishers). That is not an excuse for opaque failures; it is a reason to make **failure modes diagnosable** and **integration paths explicit**.

This change request does **not** ask for infinite free capacity. It asks for **clarity**, **predictability**, and **operator hygiene** so that serious apps can depend on Mainnet blob upload **or** deliberately choose **authenticated publishers**, **CLI**, or **self-hosted** infrastructure — without weeks lost to unexplained 502s.

---

## Facts we anchor on (no speculation)

- Walrus publishers expose OpenAPI-style specs at **`/v1/api`** on aggregator/publisher hosts ([public services](https://docs.wal.app/docs/system-overview/public-aggregators-and-publishers)).
- Encoding uploads is memory-heavy ([system constraints — memory](https://docs.wal.app/docs/system-overview/system-constraints)): large blobs need adequate RAM on the publisher host; OOM upstream commonly surfaces as **502** through nginx.
- Default **~10 MiB** limits are common for public endpoints ([same page — blob size note in docs context](https://docs.wal.app/docs/system-overview/public-aggregators-and-publishers)); exceeding limits should be a **defined HTTP response**, not necessarily a generic gateway error.

---

## Impact when Mainnet publishers return sustained 502

| Who | Effect |
|-----|--------|
| **End users** | Cannot publish a form or submit a response through the normal UI; trust erodes even when the app is correct. |
| **Integrators** | Must build retries, multi-host failover, manual blob-ID paste flows, and user education — all of which we implemented in WalForms, but this is **duplicate work** for every team. |
| **Operators** | Support noise (“your URL is broken”) without structured signals from clients because **502** does not distinguish overload, OOM, misconfiguration, or intentional rejection. |

---

## Proposed solutions (technical, actionable)

### A. For publisher operators (HTTP edge + Walrus daemon)

1. **Health and readiness**
   - Expose a **readiness** signal that reflects whether the publisher daemon can accept a **`PUT /v1/blobs`** (encoding pipeline up, disk/RAM within bounds, upstream storage nodes reachable enough to attempt certification). Many setups already serve **`/v1/api`**; aligning load-balancer health checks with **actual upload readiness** reduces traffic to broken backends that only produce **502**.
   - Publish **runbooks**: minimum RAM vs max blob size (aligned with Walrus memory guidance), recommended timeouts for reverse proxies given encoding latency.

2. **HTTP semantics instead of opaque 502 where possible**
   - **503 Service Unavailable** with **`Retry-After`** when the daemon is temporarily overloaded or restarting — lets clients backoff cooperatively (WalForms already retries **502/503/504**, but **503 + Retry-After** is semantically clearer than **502** for “try again soon”).
   - **413 Payload Too Large** when a blob exceeds configured policy — clearer than nginx **502** when the failure is size-related.
   - **401 / 403** with a JSON body when an endpoint requires **authenticated publisher** access — clearer than **502** so clients stop treating the failure as “maybe transient gateway noise.”

3. **Structured error bodies**
   - When returning **4xx/5xx**, include a small JSON payload (even `{ "error": "upstream_timeout", "detail": "..." }`) so integrators can log categorically. Today, HTML nginx pages and bare “error code: 502” strings are hard to automate.

4. **Monitoring and incident transparency**
   - Operator-visible dashboards on **5xx rate**, **latency**, and **OOM kills** for the publisher process.
   - Optional public status page or RSS — not mandatory for community operators, but disproportionately valuable when documentation says there is **no SLA**.

### B. For ecosystem documentation and operator listings

1. **`operators.json` parity**
   - Today the JSON heavily lists **aggregators** for Mainnet; **publishers** are much clearer for **Testnet**. Where community Mainnet publishers exist and consent to listing, **documenting them with the same metadata pattern** (operator name, functional flag, optional capacity notes) reduces guesswork. We are **not** asking Mysten to endorse operators without vetting — only for a **consistent machine-readable surface** when operators opt in.

2. **Integration decision tree (docs page)**
   - A single page that states: browser **`PUT`** → supported vs “use CLI” vs “use authenticated publisher” vs “self-host,” with links to [Operate a publisher](https://docs.wal.app/docs/operator-guide/publishers/operating-publisher), [Authenticated publisher](https://docs.wal.app/docs/operator-guide/publishers/auth-publisher), and [Walrus CLI storing blobs](https://docs.wal.app/docs/walrus-client/storing-blobs). This removes integrators guessing from forum posts.

### C. For integrators (already demonstrated in WalForms)

We implemented what client-side code **can** do without privileged access:

- **Multiple publisher base URLs** with ordered failover.
- **Limited retries** on **502 / 503 / 504** with backoff (transient gateway behavior).
- **Manual continuation**: user runs **`curl.exe`** (Windows) or uploads via CLI/local publisher, pastes **blob ID** to finish the Sui transaction — documented in the UI and in [`walrus-mainnet-publisher-502-report.html`](walrus-mainnet-publisher-502-report.html).

This is **necessary** but **not sufficient** for a frictionless Mainnet ecosystem at scale.

---

## Walrus Sessions hackathon brief — why “run your own **local** publisher” is not the whole answer

Walrus documentation rightly recommends **operating a publisher** when you need reliability ([Operate a publisher](https://docs.wal.app/docs/operator-guide/publishers/operating-publisher)). That guidance shines for **teams running infrastructure**. It does **not**, by itself, satisfy the **Sessions hackathon product surface** if interpreted only as **localhost**:

| Constraint | Why it matters for this hackathon |
|------------|-------------------------------------|
| **Deploy surface** | WalForms ships as a **static site** (e.g. Netlify / Walrus-hosted HTML). Respondents and judges open a **public URL**. A publisher bound to **`127.0.0.1`** on the builder’s laptop is **not reachable** from those browsers — the browser cannot upload to someone else’s loopback interface (nor should it). |
| **Brief intent** | The brief asks for **shareable form links**, **community-collected feedback**, and a **demo** others can reproduce from the deployed app — not only a CLI path on one machine. |
| **Role of local publisher** | Running **`walrus publisher`** locally remains **valuable** for debugging, for **`curl.exe`** uploads on the **same** machine, and for completing the **manual blob ID** continuation flow when HTTP fails. It is a **developer workaround**, not a substitute for **network-accessible** Mainnet blob ingress that every visitor can use without SSH-ing into your PC. |
| **Self-hosted vs local** | A publisher on a **public hostname** (VPS, tunnel, authenticated endpoint) **can** match production integration — but that is **operator-grade work** and cost (SUI/WAL, uptime). The hackathon still expects the **public app** to have a credible story when relying on **community** endpoints; that is exactly why this change request pushes operators toward clearer behavior on shared Mainnet publishers. |

**Bottom line:** “Only run local publisher” does **not** replace the need for **healthy, documented, or honestly authenticated** Mainnet HTTP publishers — otherwise WalForms cannot fulfill “collect structured feedback” from arbitrary wallets at a shareable link without turning every respondent into a systems administrator.

*(Ghi chú tiếng Việt: Publisher chỉ chạy trên máy dev không thay thế được yêu cầu “ứng dụng công khai + link chia sẻ” của đề thi — chỉ là kênh phụ để debug hoặc upload thủ công.)*

---

## Success criteria (measurable)

| Metric | Target |
|--------|--------|
| **Diagnosability** | Integrators can distinguish “overload” vs “reject” vs “too large” vs “auth required” without HTML scraping. |
| **Retryability** | Transient failures prefer **503 + Retry-After** over generic **502** where accurate. |
| **Discoverability** | Operators who run public-facing Mainnet publishers can opt into **operators.json** with clear metadata. |
| **Documentation** | New Walrus app developers find one official decision tree for blob upload on Mainnet within **15 minutes** of reading docs. |

---

## Closing

Mainnet publishers sit on the critical path for **Walrus-native apps** that want static hosting and honest UX. We respect that publishers cost **SUI** and **WAL** and that no operator owes unlimited free service. What we ask for is **engineering honesty at the boundary**: HTTP responses that tell the truth, documentation that maps integration choices, and listings that reduce roulette.

WalForms will keep shipping fallbacks and education for users. **Better publisher behavior and clearer docs multiply that effort across every team building on Walrus — including Sessions.**

— **WalForms / OlympusXVN**  
*Walrus Sessions Round 2*

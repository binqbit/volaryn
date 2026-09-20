# Volaryn Architecture

This document defines the system's responsibilities, financial rules, integrations, and deployment contract. The [README](../README.md) introduces the product; the [product brief](product.md) explains its user problem, agreement, related products, and boundaries. The [technology stack](tech-stack.md) defines dependency choices, rationale, and compatibility requirements. Paths, APIs, and commands below define the implementation contract.

## 1. Design constraints

Volaryn connects a PreStocks holder seeking temporary downside protection with a writer willing to acquire that position under agreed terms. The holder keeps the underlying until exercise; the writer commits the entire USDC payout before activation.

| Requirement                      | Architectural consequence                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A concrete holder problem        | Position discovery and protection are the primary workflow.                                                                                          |
| A complete, demonstrable outcome | Funding, activation, independent exercise, and unused-expiry recovery use the actual Solana program.                                                 |
| A reason to use Solana           | Program-controlled collateral and atomic settlement enforce the agreement.                                                                           |
| Execution quality                | Exact asset identity, visible funding, explicit transaction status, and failure-safe transfers are core behavior.                                    |
| Meaningful PreStocks integration | Official mints, market context, token mechanics, and asset lifecycle determine eligibility and presentation. Competing pre-IPO issuers are excluded. |
| Simple operation                 | One Rust application process, a bundled React frontend, PostgreSQL, and a reproducible Compose entry point.                                          |

The first five requirements reflect the [Stocklana brief and sponsor criteria](https://hackathons.solana.com/hackathons/stocklana). Submission schedules and prize administration belong outside this architecture.

The financial scope is one funded offer for one exact asset quantity, one holder, and one full exercise. There is no pooled collateral, margin, liquidation engine, secondary options token, automated market maker, or reserve investment. A funded offer is executable inventory; a price estimate is not.

## 2. System shape and dependencies

Use a **modular monolith** for the application and a separate **on-chain settlement program**. Application modules share one process and database; the chain is the authority for financial rights.

```mermaid
flowchart LR
    U[Holder or writer] --> UI[React application and wallet]
    UI -->|Same-origin HTTP| API[Rust API and static files]
    API --> DB[(PostgreSQL read models)]
    API -->|Market context| PS[PreStocks API]
    API -->|Account reads and reconciliation| RPC[Solana RPC]
    UI -->|Wallet-signed transactions| RPC
    RPC --> P[Volaryn Rust program]
    P --> R[Isolated USDC reserves]
    P --> T[PreStocks Token-2022 settlement accounts]
```

The browser's normal RPC transport is a restricted same-origin backend proxy. The diagram separates transaction authorship from transport: the wallet signs, the backend forwards, and the program decides. An independently hosted client can submit the same instructions through another RPC.

| Area                    | Selected dependencies                                                                 | Purpose                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Backend                 | Rust, Tokio, Axum, Tower, `tower-http`                                                | Async HTTP, static frontend delivery, request limits, and tracing middleware.                                  |
| External access         | `reqwest` with Rustls; nonblocking `solana-rpc-client` and compatible types           | PreStocks HTTP and typed chain access without a separate integration service.                                  |
| Persistence             | PostgreSQL through SQLx with embedded migrations                                      | Durable projections and observations in one transactional database; no ORM layer.                              |
| Data and errors         | Serde, `serde_json`, `thiserror`, `tracing`, `tracing-subscriber`, `rust_decimal`     | Typed boundaries, stable errors, structured logs, and exact off-chain numeric handling.                        |
| Program                 | Rust, Anchor, `anchor-spl`, Token-2022 interfaces                                     | Account constraints, PDA authority, and extension-aware token operations.                                      |
| Frontend                | React, TypeScript, Vite, React Router, CSS Modules                                    | A static application with feature modules; no server-side rendering service.                                   |
| Wallet and transactions | Solana Kit HTTP RPC, Wallet Standard plugin, React bindings, generated program client | Wallet discovery, account decoding, signing, and HTTP-based submission and confirmation.                       |
| Generated contracts     | Anchor IDL and Codama; Utoipa, `openapi-typescript`, `openapi-fetch`                  | Generate matching program and HTTP clients; only generated code and client helpers enter the frontend runtime. |
| Verification            | Rust tests, LiteSVM, Vitest, React Testing Library, Playwright                        | Financial invariants, adapter behavior, component interactions, and complete browser flows.                    |

The [technology stack](tech-stack.md) is the reference for package selection, alternatives, and toolchain compatibility. Keep native React state and typed HTTP helpers; generate the Kit-compatible program client from the IDL. Build-time generation and test tooling do not add runtime services. Dependency changes must pass the stack's compatibility gates.

### Repository layout

```text
volaryn/
├── Cargo.toml                 # Rust workspace: backend, program, local tooling
├── Cargo.lock
├── rust-toolchain.toml
├── Anchor.toml
├── backend/
│   ├── build.rs               # Track embedded migration files
│   ├── src/{http.rs,application.rs,domain.rs,observations.rs,adapters/}
│   └── migrations/
├── frontend/
│   └── src/{app,features,components,lib}/
├── programs/volaryn/src/      # Instructions, accounts, token rules, errors
├── packages/protocol/         # Generated IDL and TypeScript program client
├── config/                    # Network manifests and reviewed asset policies
├── tools/
│   ├── localnet/              # Validator bootstrap and disposable fixtures
│   └── test                  # Native fast checks and containerized test modes
├── tests/                     # Program scenarios and browser flows
├── package.json               # npm workspace and build scripts
├── package-lock.json
├── Dockerfile                 # Application, local tooling, and build targets
├── compose.yaml               # Self-contained local demonstration
├── compose.test.yaml          # Isolated test overrides and one-shot runner
├── compose.live.yaml          # Application connected to an existing deployment
├── README.md
└── docs/
    ├── architecture.md
    ├── product.md
    ├── pipeline.md
    └── tech-stack.md
```

`http` validates transport input and calls `application`; application services coordinate domain rules and adapter interfaces. `domain` has no HTTP, database, or SDK dependency. Public deployment and chain-observation DTOs live in `observations`, where serialization and API-schema annotations belong. Adapters implement chain reads, asset context, and persistence. Jobs call the same services as request handlers. Define interfaces at those external boundaries, not one interface per class or table.

The program owns settlement validation independently of backend checks. Frontend features cover positions, offers, protection, and writer commitments; shared components contain presentation rather than financial rules. Generated files are never hand-edited. The workspace build regenerates them and checks for drift.

### Business changes and extension boundaries

Keep the product adaptable through cohesive modules and a few explicit boundaries. Introduce an interface where an external dependency must be replaceable or isolated for tests; keep ordinary business logic in concrete functions and types. Extract a strategy only when a real second behavior needs independent selection. No plugin framework, generic workflow engine, interface per entity, or environment switch per feature is required.

| Change                                                   | Owning boundary and preserved contract                                                                                                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replace a data or RPC provider                           | Adapters normalize identity, units, freshness, and errors into application types. Provider payloads do not become domain or UI contracts.                                                           |
| Change discovery, offer presentation, or suggested terms | Application use cases and frontend feature modules evolve together. Suggestions remain separate from executable, writer-funded offers.                                                              |
| Change asset admission or commercial rules               | Admission policy governs new commitments. Any new fee or economic rule is explicitly disclosed and enforced in the agreement version that supports it; active terms remain unchanged.               |
| Change storage or indexing                               | Read-model query and checkpoint operations belong to the persistence boundary. SQL and database transactions stay inside the adapter.                                                               |
| Extend financial rights                                  | Versioned program instructions own authorization and settlement; generated clients expose those operations to application features. A backend configuration change cannot create an on-chain right. |

Wire concrete adapters at application startup using the committed deployment configuration. Add only the operations a use case needs; avoid a generic repository or universal settlement interface. Frontend features consume typed application models and generated transaction clients through shared helpers, so changing a provider does not require rewriting screens. Expose actions supported by the configured program and agreement version; unknown versions must not be presented as executable.

## 3. Sources of truth and integrations

| Information                                          | Authority                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| Agreement terms, holder, status, reserve, settlement | Solana program and token accounts                                |
| Wallet inventory and transfer capabilities           | Token accounts, mint state, and their owning token programs      |
| PreStocks identity and market context                | Official PreStocks data, checked against reviewed mint admission |
| Supported assets and permitted new expiries          | Versioned asset policy, with critical limits enforced on chain   |
| Search results and dashboards                        | Rebuildable PostgreSQL projections                               |
| Pending transaction feedback                         | Browser transaction state, reconciled against chain confirmation |

### PreStocks

The backend reads public asset context from [`GET https://prestocks.com/api/prestocks`](https://prestocks.com/api/prestocks). The adapter maps `contract_address`, `name`, `symbol`, `tokenPrice`, `markPrice`, `impliedValuation`, `markValuation`, and `supply` from the response. Public reads use no API key; API availability and response shape remain external dependencies, not settlement prerequisites.

Normalize this response through a typed adapter with bounded timeouts, retries, schema validation, and caching. Join assets by exact mint and network, never by ticker. API additions do not automatically become tradable. Preserve source provenance and `received_at`; receipt time must not be labelled price time. A market observation timestamp requires explicit source evidence. Missing values remain unavailable rather than becoming zero.

Wallet discovery uses [`getTokenAccountsByOwner`](https://solana.com/docs/rpc/http/gettokenaccountsbyowner) for Token-2022 holdings and the applicable USDC token program. Read mint state for decimals, extensions, and authorities. Aggregate holdings for display while retaining individual account identities and spendable balances.

**Mint validation:** admission checks each official mint through [Solana's account RPC](https://solana.com/docs/rpc/http/getmultipleaccounts) on the selected network. Verify the owning token program, decimals, authorities, and extension configuration, including transfer fees, scaled UI amounts, permanent delegates, pausing, freeze authority, confidential transfers, and transfer hooks where present. Read the fee schedule applicable to the transaction's epoch; never hardcode an issuer-wide fee, asset count, decimal precision, or extension set. Recheck transfer-relevant configuration during transaction review.

### Quantity and issuer transfer rules

The agreement fixes **`quantity_raw`: the gross base-unit debit from the holder**, not a display balance or a guaranteed net writer receipt. If the supported mint applies an issuer-level transfer fee, the writer accepts that fee exposure. During exercise the holder transfers exactly the agreed quantity and receives the entire agreed USDC payout; any applicable issuer fee reduces the underlying credited to the settlement account. The program records the actual spendable credit. No additional holder quantity or writer approval is requested when a fee changes. This follows Token-2022's [transfer-fee semantics](https://solana.com/docs/tokens/extensions/transfer-fees).

Before signing, both parties see the gross quantity, estimated issuer fee, estimated net receipt, fixed USDC payout, premium, and expiry. A funded offer stores the gross-quantity interpretation explicitly. The platform fee is zero in this design; network fees and account rent are separate and never deducted from the payout.

[Scaled UI amounts](https://solana.com/docs/tokens/extensions/scaled-ui-amount) affect presentation, not raw balances. Use the token program's conversion semantics for human input, show the resolved raw obligation on review, and keep it immutable. A multiplier change can change the displayed quantity but cannot rewrite the agreement. Market-value calculations require a verified match between the API price unit and displayed token unit; otherwise show the source values separately and disable derived percentage/valuation presets.

Support ordinary transparent transfers for reviewed Token-2022 extension combinations. Mint-level confidential-transfer configuration is not a promise to support confidential balances. Unknown extensions or an active, unreviewed transfer hook prevent new admission; unsupported issuer changes can also make an existing transfer fail atomically. Do not accept arbitrary hook programs or additional CPI accounts.

### Asset policy and lifecycle

A reviewed policy binds network, mint, token program, decimals, supported extension behavior, official source, review date, review-validity deadline, admission status, and maximum expiry. The on-chain `AssetPolicy` enforces enablement, review validity, and expiry limits at offer creation and activation. The richer evidence stays in versioned configuration. Administrative policy transactions are signed outside the application process.

Lifecycle limits come from reviewed official notices, such as the [SPACEX notice](https://prestocks.com/spacex) and [XAI notice](https://prestocks.com/xai); a market-data response alone does not establish eligibility. Store each applicable deadline and its source in the asset policy. Set maximum protection expiry strictly before any applicable conversion deadline, with an explicit reviewed buffer. Missing or outdated policy blocks new agreements.

Recheck policy at activation. Subsequent policy changes can stop new commitments but cannot change an active agreement's mint, quantity, payout, or expiry, or introduce an administrative exercise veto. Display new lifecycle warnings on active protection. There is no automatic migration into a replacement mint.

### Optional Pyth context

Pyth is an optional market-context adapter, absent from the core runtime dependency graph. Its data may support a meaningful comparison or writer decision, but never authorizes exercise or determines payout.

The [official pre-IPO announcement](https://www.pyth.network/blog/anthropic-openai-pre-ipo-feeds-on-pyth) identifies OpenAI and Anthropic indicators as **Pyth Indices**, with commercial terms separate from Pyth Pro. Do not assume a public Hermes feed, a Pyth Pro entitlement, or a directly comparable PreStocks token price. Enabling this adapter requires verified API access, units, provenance, and usage rights. There is no mandatory Pyth package, credential, or environment variable.

## 4. On-chain agreement

Use one Anchor program. Each agreement has its own reserve; funds cannot back multiple agreements.

### Settlement engine choice

A dedicated Rust/Anchor program is the reference design specified here. Existing infrastructure such as [Epicentral's Solana Option Standard](https://beta.epicentral.markets/) is a reuse candidate, subject to verification against the same requirements: exact PreStocks Token-2022 behavior, fixed gross delivery, isolated full USDC backing, holder custody until exercise, atomic settlement before expiry without a price oracle or fresh writer approval, and lifecycle restrictions on new agreements. Any protocol fees must preserve the full promised payout and the documented cost model.

Reuse also requires inspectable program behavior, deployment and upgrade controls, suitable licensing, and reproducible local tests. An alternative settlement engine must satisfy the [settlement invariants](#7-trust-boundaries-and-verification), with its dependencies and integration contract defined in this specification.

### Accounts

| Account                             | Responsibility                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ProtocolConfig`                    | Deployment identity, exact USDC mint/program, and policy authority. Settlement identity is immutable for a deployment.                                                                                                                           |
| `AssetPolicy`                       | Admit a specific underlying and constrain new agreements.                                                                                                                                                                                        |
| `Agreement` PDA                     | Agreement version, writer, unique nonce, optional designated holder, activated holder, exact mints/programs, raw underlying quantity, payout and premium in USDC base units, acceptance deadline, expiry, policy version, timestamps, and state. |
| Reserve token account               | Holds at least the promised USDC payout; the agreement PDA controls spending.                                                                                                                                                                    |
| Underlying settlement token account | Receives the exercised underlying; controlled by the PDA until atomic handoff to the writer.                                                                                                                                                     |

Agreement addresses derive from a fixed seed, writer address, and unique nonce. Retain terminal agreement records to prevent reuse and permit account-based reconstruction. Validate account ownership, PDA seeds, signers, mint identities, token programs, and authorities using [Anchor constraints](https://www.anchor-lang.com/docs/references/account-constraints).

### Agreement evolution

Record an explicit agreement version from creation, binding its account layout and financial rules independently of the asset-policy version. Keep economic terms, participant authorization, and lifecycle transitions separate in program code. The base agreement binds exercise authority to the activated holder and provides no transfer instruction. Do not allocate speculative transfer fields or build a second financial model in advance.

Compatible changes retain decoding and behavior for existing accounts. A materially different right uses a new agreement version or a separate deployment, with updated clients and explicit rules for servicing earlier agreements. Identify records by network, program, and agreement address. Existing rights do not migrate merely because the application is redeployed; incompatible changes require a defined migration or continued service by the original program. Versioning does not remove the trust placed in a [program upgrade authority](https://solana.com/docs/programs/deploying#program-management).

For example, a transferable-right variant would add an explicit on-chain change of exercise authority, define sender authorization and recipient consent and eligibility rules, and route exercise and payout to the authorized holder. The recipient must still satisfy the asset-delivery requirement. Its tests must resolve transfer/exercise races, reject transfers after exercise or expiry, reject the previous holder after transfer, and preserve the reserve, writer identity and obligation, premium, quantity, payout, and expiry. Existing holder-bound agreements retain their original rules. This is a future product decision, not an implicit capability of the base agreement; it does not require introducing an option token or marketplace into this design.

### State machine

```mermaid
stateDiagram-v2
    [*] --> Funded: Writer deposits full payout
    Funded --> Cancelled: Writer cancels before activation
    Funded --> Active: Holder pays premium before acceptance deadline
    Active --> Exercised: Holder delivers before expiry
    Active --> Expired: Writer reclaims at or after expiry
```

An unaccepted offer becomes unavailable at its acceptance deadline; the writer can cancel and recover its reserve. For active agreements, expiry is effective by chain time even before a reclaim transaction changes the stored state. There is no scheduler required for correctness.

### Funding and activation

`create_offer` requires the writer's signature, valid policy, positive quantity, payout, and premium, and `now < accept_before <= expires_at`. Both payout and premium use the exact USDC mint and token program bound by `ProtocolConfig`. It initializes the agreement and both token accounts, then deposits the entire payout. The writer pays account rent. The offer becomes funded only when all operations succeed.

Offers can be addressed to a holder; an unrestricted offer can be accepted once by any eligible signing holder. `activate` verifies the designated holder when present, current policy, deadline, and reserve. It atomically pays the fixed premium from holder to writer and records `Active`. The premium is a separate payment that never reduces the reserve or payout; the writer keeps it whether the right is exercised or expires unused. The underlying remains with the holder. A cancellation and activation racing on the same account cannot both succeed.

### Independent exercise

`exercise` requires the recorded holder's signature, `Active`, and `Clock.unix_timestamp < expires_at`. It consumes the entire right once; partial exercise is not supported. In one atomic instruction it:

1. Validates the fixed account identities, reserve, and holder's spendable source balance.
2. Transfers `quantity_raw` to the predefined underlying settlement account using the admitted token behavior, and measures the credited amount.
3. Pays the exact reserved USDC amount to a holder-owned account.
4. Transfers ownership authority of the underlying settlement account to the immutable writer and records `Exercised` and the net credit.

Any failure rolls back every transfer and state change. There is no price threshold, oracle read, fresh writer signature, backend authorization, or mutable admission-policy check in this path.

The settlement account is a **custom token account, not an associated token account**. Allocate it for the actual mint-required extensions and initialize it without `ImmutableOwner` or `CpiGuard`, with no delegate and no separate close authority. This permits the PDA to hand token-account authority to the recorded writer through Token-2022 `SetAuthority`; its runtime owner remains Token-2022. The writer cannot modify the destination before exercise. Handoff gives the writer control of the received balance without a second mandatory token transfer; later consolidation may incur an issuer fee. This design follows the [official authority implementation](https://github.com/solana-program/token-2022/blob/bb07b98567d5519e4cfcfdd05e9a0b283f6c0cae/program/src/processor.rs#L709) and [immutable-owner rules](https://solana.com/docs/tokens/extensions/immutable-owner). Compatibility tests against the pinned program validate account initialization and authority handoff for each admitted extension combination.

The client must discover this non-associated writer account. Exercise accepts one holder-owned source account containing the required spendable raw quantity. If holdings are split, the UI explains any consolidation and its transfer fees before asking for approval; it never silently changes the contractual quantity.

### Expiry, refunds, and account cleanup

At `now >= expires_at`, exercise is rejected and `reclaim_expired` allows the writer to recover USDC and records `Expired`. `cancel_offer` only applies to `Funded`. Both return funds to verified writer-owned accounts. Active collateral cannot be withdrawn, lent, or used to pay platform expenses.

Use `reserve >= payout`, not strict equality: unsolicited transfers must not break a valid agreement. Measure underlying delivery by the balance delta, not the settlement account's total. A writer-signed `cleanup_terminal` instruction, available only after a terminal transition, recovers USDC surplus to the writer and can hand over any still-PDA-controlled underlying account instead of requiring it to be empty. After exercise the writer already controls that account. Rent recovery is optional; dust, issuer restrictions, or withheld fees must never gate exercise or a reserve refund. Terminal agreement records remain allocated.

## 5. Application behavior and API

The backend serves a same-origin REST API, static frontend files, and bounded background polling. It holds no live holder, writer, policy, or deployment private keys. Public account data needs no login; all financially meaningful mutations require on-chain signatures. There are no email accounts, JWT sessions, custodial wallets, or server-side transaction signing.

| Surface                                                                                | Responsibility                                                                                                        |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /api/config`                                                                      | Public network identity, program ID, USDC mint, protocol/client version, and demo status; never provider secrets.     |
| `GET /api/assets`                                                                      | Admitted assets, normalized source context, policy, and freshness.                                                    |
| `GET /api/positions?owner=...`                                                         | Verified supported balances, source token accounts, and transfer restrictions.                                        |
| `GET /api/offers?mint=...`                                                             | Funded, still-acceptable offers with exact terms, any designated holder, observed chain slot, and funding status.     |
| `GET /api/agreements?holder=...` or `?writer=...`, and `GET /api/agreements/{address}` | Holder/writer views, exact terms, reserve, and effective expiry state.                                                |
| `POST /rpc`                                                                            | Bounded allowlist of required account-read, simulation, blockhash, status, and signed-transaction submission methods. |
| `GET /health/live`, `GET /health/ready`, `GET /health/index`                           | Process liveness, verified chain transport, and index availability respectively.                                      |

List endpoints accept `after`, `limit` (default 50, maximum 200), `holder`, `writer`, `mint`, and `status`. Responses remain arrays, with `X-Next-Cursor` only when another page exists. Address ordering provides keyset pagination; each page is a fresh observation, not a frozen snapshot across requests. The agreement detail endpoint performs a primary-key lookup and falls back to a direct chain read if the projection is missing, stale, or unavailable.

There is no REST endpoint that makes a protection active in PostgreSQL. Clients construct instructions from the generated program client, reread relevant chain accounts, simulate, ask the wallet to sign, submit, and observe confirmation. A response or signature alone is not financial success.

Track `awaiting_signature`, `submitted`, `confirmed`, `finalized`, and `failed` distinctly. Display confirmed results as provisional until finalized. On a timeout, query signature status and account state before offering another attempt; refresh an expired blockhash only after reconciling the earlier attempt. Replays cannot pay twice because program state transitions are single-use.

A persistent browser journal holds one pending action per network, program, and signing account, including its agreement, operation, public signature, and last valid block height. After reloading or reopening a tab, reconnecting the same wallet resumes observation. Web Locks serialize signing and journal changes across tabs on the same origin; a new action rereads the journal while holding the lock. Private keys and signed transaction bytes are never persisted. Storage failure prevents new submissions rather than discarding an unknown outcome. Clearing browser data discards this local recovery record; it cannot undo a chain transaction.

Submission allows a bounded RPC rebroadcast of the same signed bytes. A replacement signature is never created automatically. Confirmed errors remain provisional until finalized. After the finalized block height exceeds the signature lifetime, reread signature history and the agreement at or beyond that finalized root. Version 1's immutable holder and monotonic activation/settlement history can establish whether the action completed; label this as an effect verified from agreement state, not proof of the original signature's inclusion. Unsupported identities or ambiguous history remain unresolved. New contract semantics, including transferable rights, require an updated reconciliation policy.

Use Rust integer base units with checked arithmetic and wider intermediates, TypeScript `bigint`, and decimal strings over Volaryn's REST API. Solana JSON-RPC keeps its own numeric encoding through Kit's lossless transport and the proxy; never convert financial values through JavaScript numbers. Timestamps use UTC; the program's clock decides expiry. Return stable REST error codes with human-readable messages, including expired offer, wrong network, unavailable asset data, insufficient deliverable balance, and issuer-restricted transfer; preserve JSON-RPC result/error envelopes on `/rpc`.

**My Positions** starts from verified supported wallet holdings. **Choose Protection** filters actual funded offers by exact mint, selected quantity and acceptable terms, holder restrictions, and valid admission policy. Each offer retains its fixed quantity and terms; the client cannot resize it to fit a position. When no funded offer matches, show that result explicitly. A failed or stale lookup is an availability error, not evidence that no offers exist; neither case produces a synthetic executable quote.

Public agreement browsing is distinct from wallet holdings. Each page load starts disconnected; balance requests require an explicit wallet connection and are scoped to its address. Disconnecting removes personal observations from view. The interface displays the connected wallet identity and identifies preloaded local test balances. An active agreement is described as personal protection only when its holder matches that address; another holder's agreement remains read-only. Pending transaction recovery resumes when the same wallet reconnects, without automatic signing or resubmission.

**Review Offer** shows gross quantity, estimated net writer receipt, payout, USDC premium, acceptance deadline, protection expiry, reserve evidence, required source balance, and transaction costs. Present token price, mark price, implied valuation, and mark valuation as separately labelled context, distinct from the contractual payout. Refresh eligibility, funding, and holder balances before signing. **Active Protection** exposes holder-initiated full exercise and its deadline; a price fall never triggers automatic exercise. Separate an active right from the holder's ability to deliver: underlying can be moved or sold, and one balance cannot satisfy multiple exercised agreements. Avoid claims that the USDC payout is a net investment return or a guaranteed dollar value.

**Writer Commitments** supports setting terms and creating a fully funded offer, cancelling unaccepted offers, inspecting active locked reserves, reclaiming expired reserves, and locating delivered tokens after exercise. Review includes the committed capital, estimated net token receipt, premium, duration, and issuer risks. Both roles can inspect agreement accounts and transaction links; all actions use the same wallet-signed program instructions described above.

### Read models and recovery

PostgreSQL stores asset snapshots, normalized market observations, agreement projections, and reconciliation cursors. Financial balances are observations tagged with network, program, slot, and commitment. One bounded worker per application writes short atomic transactions; HTTP handlers do not hold transactions while waiting on upstream calls. Bounded batches upsert individual agreements under row locks in stable address order; indexing never deletes the table. Each row rejects a lower finalized slot. The reconciliation checkpoint is the highest observed slot, not a claim that all rows share one snapshot. A failed batch rolls back its rows and checkpoint together; successful earlier batches remain usable with their own observation metadata.

Persist raw financial amounts as validated decimal strings in typed JSONB projections; use bounded exact numeric columns for ordered checkpoints and dedicated fields that need numeric queries. Startup runs embedded SQL migrations under PostgreSQL migration locking before readiness. Stop the previous writer for an incompatible schema change; a lock alone does not make old application code compatible with a new schema. The [stack's persistence and migration contract](tech-stack.md#3-persistence-numeric-precision-and-migrations) defines query validation, schema compatibility, and recovery.

On startup and every thirty seconds, discover retained agreement addresses using a discriminator filter and zero-length account data. Between discovery passes, poll funded and active agreements every two seconds. Fetch each agreement and its reserve together through `getMultipleAccounts`: at most fifty pairs per response and four concurrent requests. Each pair carries its actual finalized response slot; `minContextSlot` rejects reads behind the discovery or stored checkpoint. Different batches may have different slots. Discovery has a separate 32 MiB response budget; public RPC remains bounded at 2 MiB. Standard account discovery has no pagination, so a larger deployment may need an indexed source behind the same adapter. [Solana account batches](https://solana.com/docs/rpc/http/getmultipleaccounts), [account discovery](https://solana.com/docs/rpc/http/getprogramaccounts). Confirmed browser feedback stays separate from durable finalized observations. Logs can accelerate refresh but are not the sole source of truth. Missed polls, restarts, or a deleted cache cannot change agreements. Rebuilding recovers authoritative terms and states, though previously cached market history can be lost.

Stale market data disables derived pricing and new market-based suggestions; reviewed fixed offers remain governed by their on-chain terms. Stale chain reads must be labelled and refreshed before presenting an offer as executable. External-data failures never disable the contract's exercise path. If the API is unavailable, a published IDL/client and the agreement address are sufficient to exercise through another compatible RPC.

### Scaling the application

The reference deployment uses one application instance, one PostgreSQL service, and one reconciliation worker. Measure request latency, reconciliation lag, RPC usage, and database contention before changing that topology. Improve bounded queries, indexes, batching, and cache reuse within the existing modules first.

PostgreSQL provides shared transactional storage when measured load requires multiple application instances or independently scheduled indexing. Explicitly assign reconciliation ownership before enabling replicas so they do not duplicate RPC scans. Row-level slot guards protect data integrity but do not allocate worker ownership. Validate connection budgets, schema compatibility, concurrent updates, and recovery before changing the topology. These changes preserve the product and settlement contracts but still require operational work and compatibility tests. A separate worker or service is introduced only when independent capacity, failure isolation, or deployment is needed.

## 6. Packaging and configuration

The local deployment contract provides one entry point:

```sh
docker compose up --build
```

It serves the application at `http://localhost:8080` and requires **no environment variables, cloud account, API key, installed Rust toolchain, or installed Node runtime on the host**. Docker and Compose are the host prerequisites; the first image build needs network access.

| Compose service | Role                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `validator`     | Local Solana ledger with the required token programs, persisted in a named volume.               |
| `bootstrap`     | One-shot verification of the genesis-loaded program, policy initialization, and fixture seeding. |
| `database`      | PostgreSQL with a named volume, health probe, and a dedicated non-superuser application role.    |
| `app`           | Non-root Rust executable serving API and compiled React assets from a read-only filesystem.      |

Startup waits for database and validator health, successful bootstrap, and database migrations before readiness. After startup, `/health/ready` checks verified chain transport independently of the index; `/health/index` additionally requires a responsive database and a successful reconciliation within thirty seconds. Chain identity checks are shared and cached for at most five seconds. An index outage disables indexed lists but leaves verified RPC, wallet balances, and direct agreement reads available, including the exercise path. Initial startup still requires database migrations; process liveness is independent of dependency availability. Use Compose's documented [`service_healthy` and `service_completed_successfully` conditions](https://docs.docker.com/compose/how-tos/startup-order/). Bootstrap is idempotent: reuse matching ledger/deployment state, and fail clearly on incompatible state without resetting balances. Local reset is an explicit operation, never an automatic startup repair.

Build the frontend, backend, and program in pinned Docker build targets. The application runtime contains the Rust executable, static assets, public manifests, and CA certificates. Node, Rust, Anchor, and Solana CLI tooling remain in build/bootstrap images. Run the application without root privileges and with a read-only filesystem. PostgreSQL owns its separate writable volume. Bind the application port to loopback; publish no database or internal service ports. Compose supplies disposable local database credentials; hosted deployments provision separate credentials outside the public local fixture configuration.

Under Volaryn's own demonstration policy, the local build supplies clearly labelled disposable holder/writer demo signers, funded test USDC, and Token-2022 fixtures with representative fees and scaling. It executes the real program, including ownership handoff, rather than simulating balances in React. Fixture market context records its provenance and does not require PreStocks uptime. Demo signers and seeding routes are excluded from the live build and additionally require the expected local ledger identity.

The live Compose file runs as a standalone configuration against an already deployed program and a provisioned PostgreSQL database, without the local validator or fixture initialization. Network manifests contain public program IDs, expected genesis identity, official settlement mint, supported policies, and public RPC defaults. **`DATABASE_URL` supplies the PostgreSQL connection**; local launchers provide it automatically. An optional `SOLANA_RPC_URL` selects an alternative or authenticated RPC provider for live deployment. Both stay server-side. Hosted database connections require certificate-verified TLS. Ports, storage paths, polling limits, and upstream URLs have committed defaults rather than environment switches.

The backend exposes an allowlisted RPC proxy with request limits and no caller-selected upstream URL. Validate the network and deployed program against the manifest at startup and before enabling transactions. Wallet/network mismatch fails visibly. Live deployment keys are supplied to explicit deployment tooling outside the runtime; starting Compose never deploys or upgrades a live program. HTTPS belongs at the hosting platform's ingress.

Each network manifest must bind assets to verified issuer mints on that network; an address on mainnet does not establish a corresponding asset on devnet or a local ledger. Local fixtures demonstrate mechanics and do not establish genuine PreStocks ownership. Under Volaryn's demonstration policy, claims of actual PreStocks integration require evidence tied to verified official assets. This distinction is our transparency standard; sponsor eligibility is governed by the published bounty terms.

## 7. Trust boundaries and verification

Program invariants are explicit: complete backing before activation; immutable active terms; no writer withdrawal or veto while active; exact mint/program binding; atomic delivery and payout; one successful exercise; and non-overlapping exercise/reclaim time conditions. Enforce them in the program even when the UI has already checked them.

Issuer powers remain outside Volaryn's control. PreStocks authorities may freeze, pause, transfer, or burn underlying; USDC has its own restrictions. A [permanent delegate](https://solana.com/docs/tokens/extensions/permanent-delegate) and [mint pause](https://solana.com/docs/tokens/extensions/pausable) make unrestricted deliverability an invalid assumption. Describe protection as a funded right conditional on valid delivery, not insurance. Issuer restrictions can block settlement, but cannot produce a partial payout through a failed transaction.

Policy authority controls new admission only. Program upgrade authority is a separate trust assumption: an upgradeable deployment must disclose who controls it and cannot claim immutable guarantees. Live deployment requires an explicit upgrade policy and separate eligibility/legal review; no application checkbox establishes legal permission. These constraints do not add hosted services to the hackathon runtime.

| Verification boundary    | Required evidence                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Program                  | Funding, exact USDC premium payment on activation, writer-offline full exercise, partial-exercise rejection, full payout, net receipt, ownership handoff, expiry/refund with premium retained, double exercise, wrong mint/program/holder, cancellation race, and atomic rollback.   |
| Token behavior           | Active transfer fees and changes, scaled display changes, required extensions, custom-account sizing, no immutable owner, unset delegate/close authority, issuer freeze/pause, hook rejection, and withheld-fee cleanup.                                                             |
| Invariants               | No early reserve withdrawal, donated surplus cannot block exercise, exact expiry boundary, overflow rejection, and policy updates cannot rewrite active rights.                                                                                                                      |
| Backend/client contracts | Captured official response parsing, missing fields, price-unit mismatch, stale sources, reconciliation after restart, generated-client compatibility, and explicit rejection of unsupported agreement versions.                                                                      |
| Complete application     | Clean Compose startup, idempotent restart, exact-quantity offer matching, distinct empty/error states, holder/writer flows with real local transactions, explicit exercise and expiry presentation, backend-independent exercise through a second client, and local/live separation. |

Run formatting, linting, focused Rust/TypeScript tests, generated-artifact checks, a container build, and complete-flow tests in CI. Production RPC calls are read-only integration checks; tests never spend live assets. Log request IDs, agreement addresses, public signatures, source failures, and reconciliation lag without logging keys or credential-bearing RPC URLs.

### Test environment and entry points

Testing uses the same domain rules, generated clients, migrations, and compiled settlement program as the application. External adapters are replaceable at composition boundaries; test controls never add financial bypasses to the deployed program or live API.

| Layer                         | Execution environment                                                                                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain and interface behavior | In-process tests with controlled inputs, application time, and external responses.                                                                                                                                                 |
| Contract and token behavior   | LiteSVM loads the compiled program and the pinned token programs used by the local validator. Signature checks remain enabled for financial scenarios.                                                                             |
| Backend and persistence       | Real isolated PostgreSQL databases with production migrations, pool settings, and the application role; deterministic market and RPC adapters for mapping, timeout, and recovery cases.                                            |
| Complete user journeys        | The local validator, bootstrap, application, and browser execute real transactions. A test wallet signs with disposable keys through the wallet interface; it can also reject or disconnect without replacing transaction results. |

Versioned fixture recipes define participants, balances, token extensions, asset policies, and source responses for both contract and browser scenarios. Establish ordinary agreement states through program instructions. Each test owns its accounts and data; tests do not depend on another test's execution order. Fixture factories can express funded, active, expired, and issuer-restricted scenarios without hand-editing application balances.

The contract harness controls chain time and epochs to test expiry boundaries and fee changes immediately. [LiteSVM supports changing the Clock sysvar and advancing slots](https://github.com/LiteSVM/litesvm#capabilities). Application-clock substitution is limited to off-chain freshness and retry logic. Validator/browser tests use short test expiries and bounded polling of chain state; changing browser time cannot prove contract expiry. Readiness and confirmation checks replace fixed sleeps.

The test entry points separate in-process checks from the complete localnet environment:

| Command contract      | Responsibility                                                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./tools/test fast`   | Native lint/type/build checks, generated-contract drift, and focused domain, contract, adapter, persistence, and component tests. No container, validator process, browser stack, or standalone formatter is required. |
| `./tools/test docker` | Repository formatting and the fast checks with pinned containerized tools, for CI and build reproducibility. No validator or application services are started.                                                         |
| `./tools/test full`   | Runs the fast checks, then starts an isolated Compose environment and executes complete browser and recovery scenarios.                                                                                                |

These entry points accept a scenario selector for focused reruns and require no operator credentials. Native checks use the pinned host development tools; containerized modes supply their own toolchains. The validator container belongs to the complete localnet environment, including full application tests. Building images and dependencies requires network access; the default test scenarios use local resources and fixtures. Read-only checks against official providers run separately and report external availability distinctly from deterministic test results.

`compose.test.yaml` reuses the application topology and adds one-shot backend and browser test runners. Each full run receives its own Compose project, ledger, PostgreSQL volume, browser state, and fixture identities, with no published host ports; verify the merged configuration removes inherited port bindings. Browser tests use the [stack's secure loopback origin](tech-stack.md#8-repository-containers-and-deployment) so disposable wallet signing can use Web Crypto while the application can be independently recreated. The environment never mounts persistent demo or live data. Independent runs are isolated; scenarios within a shared ledger run serially unless they have separate state. The runner waits for readiness, returns a failing exit code on failed checks, exports diagnostics, and removes only its own resources. Restart/recovery scenarios retain their state within that run. Resetting the persistent manual demo remains a separate explicit action.

Scripted adapters reproduce stale data, malformed responses, unavailable RPC, and delayed or lost submission responses. Full settlement scenarios still submit to the real local validator; failure controls affect transport, not contract outcomes. Failed runs preserve a replayable scenario name, fixture version and seed, artifact versions, sanitized logs, transaction evidence, and browser traces under `artifacts/tests/`. Automatic retries must not turn an unexplained first failure into a passing result. Test runners, wallet helpers, and fault controls are excluded from live artifacts.

### Integration requirements and failure behavior

| Integration requirement                                 | Boundary and default behavior                                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Valid PreStocks data and verified price units           | Adapter validates responses and freshness; missing or incompatible data disables dependent calculations, without blocking exercise.                                                  |
| Official asset identity on the selected network         | Verify issuer provenance and mint accounts for that network; fixtures remain labelled simulations and unsupported mints are ineligible.                                              |
| Compatible issuer extensions and valid lifecycle policy | Require reviewed admission policy and explicit transfer compatibility; invalid policy blocks new agreements while active rights retain their terms, subject to asset deliverability. |
| Authorized Pyth Indices access and comparable units     | Enable the optional adapter only with verified access and unit mapping; missing prerequisites disable that context alone.                                                            |

These requirements are enforced at their owning boundaries. The fixed agreement requires no price oracle, privileged backend signer, or more complex collateral model.

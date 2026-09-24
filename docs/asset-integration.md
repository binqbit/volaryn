# Official asset integration

The **Official assets** page (`/issuer-assets`) reads PreStocks context and verifies mint accounts on Solana mainnet. It is independent of the local demo's assets, balances, ledger, and signing flow. A compatible observation is evidence for admission review, not an executable offer or permission to transact. Live use requires a released deployment with a matching on-chain `AssetPolicy`.

## Local PreStocks experience

The local demo uses disposable replicas of the reviewed ANDURIL, ANTHROPIC, FIGUREAI, KALSHI, NEURALINK, OPENAI, POLYMARKET, and SPACEX identities. `tools/localnet/assets.ts` maps stable local fixture seeds to `config/assets.json`; bootstrap derives the public metadata from that registry. Deployment schema 3 carries the local mint, reference mainnet mint, name, ticker, precision, and issuer page. The backend rejects unknown references, duplicate identities, altered metadata, and mainnet mints passed as local replicas.

`GET /api/assets` and `/api/config` expose the supported local assets without calling an external provider. Explore offers and Create offer share a searchable selector for name, ticker, local mint, or reference mint. Selection resolves to the **local mint** for filtering and signing. Exact-quantity filters require a selected asset and clear when it changes. Cards, agreement details, signature reviews, and per-asset wallet balances retain that identity. The official catalog also supports name, ticker, and mainnet-mint search.

Replicas use nine decimals and the shared transfer-fee/scaled-display fixture behavior; they do not claim to reproduce every live issuer setting or price. The separate contract compatibility fixture covers the full reviewed extension profile. USDC remains six decimals. Agreement observations expose the precision stored on chain, and preparation checks it against the selected mint. Creation recovery compares the mint as well as numeric terms. Each transfer still requires one account with the full quantity of the specified mint.

Every replica is labelled **Local demo**, with distinct settlement and reference mint addresses and a link to its issuer page. These tokens are not issued by PreStocks and carry no private-market exposure. A local reference establishes product context, not mainnet ownership or permission to trade. Local startup and settlement remain independent of official-source availability.

## Sources and boundaries

| Boundary            | Implementation                         | Responsibility                                                                                                                                      |
| ------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reviewed identities | `config/assets.json`                   | Exact genesis hash, mint addresses, token program, issuer authority, precision, extension profile, review validity, and expiry limits.              |
| Issuer response     | `backend/src/adapters/prestocks.rs`    | Validate official identity fields and normalize market numbers without binary-float rounding.                                                       |
| Network evidence    | `backend/src/adapters/issuer_chain.rs` | Verify mainnet genesis; decode finalized mint bytes, authorities, extensions, fee schedules, and display scaling. No signing or submission methods. |
| Source transport    | `backend/src/adapters/source_http.rs`  | Bound public HTTP reads and isolate source failures.                                                                                                |
| Catalog             | `backend/src/catalog.rs`               | Coalesce refreshes, retain labelled observations, and evaluate each reviewed asset independently.                                                   |
| Public API          | `GET /api/assets/official`             | Return identities, eligibility reasons, source status, receipt times, finalized slot, policy, and optional context.                                 |

The application requests sources only when the catalog is opened or queried. Startup, health checks, wallet discovery, signing, and exercise never wait for PreStocks. No new service, credential, database migration, or environment variable is required. The server's optional `--official-rpc-url` selects a mainnet read endpoint; it cannot change the required genesis hash and is not sent to the browser. The issuer URL is fixed to [`https://prestocks.com/api/prestocks`](https://prestocks.com/api/prestocks).

Each public HTTP read has a five-second request timeout, an eight-second overall bound, and a two-MiB response limit. A 502–504 response permits one retry within that bound; a 429 response does not retry immediately. The complete chain observation is also bounded to eight seconds. Concurrent catalog requests share a refresh, with at least 30 seconds between attempts. Sources refresh independently; last successful values remain visible as stale after failure, and observations older than 60 seconds cannot establish fresh admission. Caches are memory-only and disappear on restart.

Chain reads require finalized accounts at or beyond the observed epoch slot, within that same epoch, and a block time within 60 seconds of the server clock. This prevents an old RPC observation from appearing fresh merely because its HTTP request succeeded. Slots and raw amounts are decimal strings in the API. Server clocks must be synchronized.

## Context and units

The adapter consumes `contract_address`, `name`, `symbol`, `tokenPrice`, `markPrice`, `impliedValuation`, `markValuation`, and `supply`. Identity joins use the exact reviewed mint on the verified network, never the symbol. Newly listed mints are **unreviewed**; missing reviewed mints become unavailable for new admission. Invalid token behavior affects that asset without hiding the other assets.

Missing or null numbers remain unavailable. Numeric strings, negative values, changed object shapes, and non-finite values are not interpreted as market prices. Valid JSON numbers retain their original decimal representation. An invalid market field removes that row's context, without treating a market-data failure as a settlement restriction.

`receivedAt` means source receipt time, not price time. The consumed API does not establish a price observation timestamp or a verified price-to-display-unit contract. `observedAt` therefore remains null and `unitsVerified` is false. The interface shows source values separately; it does not calculate position valuations, payout percentages, or price-based exercise decisions. A price change cannot execute an agreement.

Catalog cards show prices rounded to at most four decimal places, using scientific notation for very small or large values. **Asset details** retains the full source representation. This presentation never changes exact wallet balances or agreement amounts. Cards align their information buttons and issuer links within each grid row. **Asset details** and **Verified token behavior** each have a dedicated ⓘ button beside the label. Clicking or activating that button from the keyboard opens a compact, scrollable tooltip anchored to the icon, with its arrow pointing back to the button. Tooltips open below or above the button and shift within the viewport as needed, independently of the information row’s width. They preserve every card's dimensions and keep the page interactive. A shared **Before trading** note explains compatibility; its **Transfer rules & token units** tooltip explains raw obligations and display multipliers once. When every asset in a catalog of at least two assets has chain evidence, transfer restrictions common to all of them appear only in that note. Search does not change this grouping. Missing chain evidence keeps restrictions on individual cards. Asset-specific admission failures, fees, settings, and additional restrictions remain on the affected card; a catalog-wide refresh failure appears above the cards while their badges and open asset tooltips identify retained observations. Issuer conversion dates and the latest permitted protection expiry stay visible in a compact block with UTC dates. The latter is the earlier of the reviewed maximum expiry and the conversion deadline minus its buffer. Exact UTC timestamps and the buffer in readable time units remain in **Asset details**.

## Token compatibility and lifecycle

The reviewed issuer profile uses nine-decimal Token-2022 mints with transfer fees, scaled UI amounts, pausing, a permanent delegate, initialized default accounts, confidential-transfer and confidential-fee configuration, an inactive transfer hook, metadata pointer, and token metadata. Exact identities and reviewed limits live in the registry rather than being inferred from these shared characteristics.

The program, backend, and browser support **ordinary transparent balances** for this profile. Confidential configuration on a mint does not enable delivery from confidential balances. The custom settlement account includes the required fee, pause, and hook account extensions; successful atomic settlement hands its ownership to the writer. Tests initialize the profile through real token instructions and exercise the compiled settlement program.

Backend admission compares live mint evidence with the full reviewed profile, including issuer authorities and precision. An active hook, unknown extension, paused transfer, changed authority, or unsupported precision blocks new commitments through the application. The program independently checks supported transparent-transfer behavior, mint identity and precision, and on-chain policy enablement, review validity, and maximum expiry. It does not store the registry's full issuer-authority profile; a direct program caller does not pass through the backend comparison. Policy operators must disable new commitments when an issuer change requires renewed review.

Frozen default accounts block new commitments; changing that default after activation does not veto delivery between already initialized accounts. Issuer changes that prevent the actual transfer still cause atomic failure, preserving the USDC reserve. Fees can change the writer's net receipt, never the gross obligation or full USDC payout. The [Token-2022 interfaces](https://docs.rs/spl-token-2022-interface/2.1.0/spl_token_2022_interface/extension/index.html) define the decoded extension semantics.

Policies contain the reviewed issuer page, review start and validity, maximum protection expiry, and any conversion deadline with an explicit buffer. Their initial review and protection horizons are 30 days; the SpaceX notice also imposes a 24-hour minimum buffer before its conversion deadline. Refreshing API prices never extends a review or deadline. Updating the registry requires reviewing the issuer notices and compatibility evidence; deployment operators must apply the same enablement, review validity, and maximum expiry to the on-chain policy before admitting commitments. Administrative signing stays outside the application.

The [SpaceX notice](https://prestocks.com/spacex) and [xAI notice](https://prestocks.com/xai) describe distinct token lifecycles. An absent or retired asset is not replaced automatically, and no mainnet mint is assumed to exist on a test network. Existing agreements retain their exact mint and terms.

## Verification

Captured public responses and raw mint bytes live in `tests/fixtures/prestocks/`; `provenance.json` records their sources and capture context. The API fixture keeps the consumed fields; the mint bytes are unmodified. These files are deterministic test evidence and are never loaded as a runtime freshness fallback.

```sh
# Deterministic adapter and policy checks; no external services.
./tools/rustup/cargo test --locked -p volaryn-backend --test issuer

# Compiled program compatibility and financial invariants.
./tools/test fast

# Explicit read-only check against the official API and actual mainnet accounts.
./tools/rustup/cargo run --locked -p volaryn-backend --bin inspect-assets
```

The inspector prints the same typed catalog as the API and exits unsuccessfully if a source cannot be refreshed. It does not deploy a program, fund an account, update a policy, or submit transactions. A fresh response can still contain unsupported, expired, or unreviewed assets; inspect each eligibility reason.

The tests cover missing and changed fields, exact numbers, unverified units, unsupported accounts, issuer-authority drift, lifecycle boundaries, epoch fee selection, display scaling, timeouts, rate limits, bounded retries, cache recovery, and coalesced reads. Browser tests use controlled responses to verify explicit mainnet context, missing/stale values, mobile layout, and the absence of financial actions. Local holder and writer journeys continue to use disposable fixtures.

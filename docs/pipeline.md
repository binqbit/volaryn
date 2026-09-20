# Volaryn Implementation Pipeline

This document defines the sequence for building Volaryn as working, verifiable increments. The [product brief](product.md) defines the user outcome; the [architecture](architecture.md) defines component boundaries and financial rules; the [technology stack](tech-stack.md) defines dependency choices and compatibility gates. This pipeline describes when capabilities become available and what evidence permits the next increment.

## Progression rules

- Each stage delivers a runnable result. The first result is an executable contract with scenario tests; the next is a small application using that same contract. Later stages extend the working system.
- A stage passes only when its acceptance checks and the earlier checks relevant to changed behavior pass. Contract changes always rerun the financial invariant suite. A successful build alone is insufficient.
- Keep earlier flows working throughout development. Split each stage into small changes that can be integrated without leaving the shared application broken. Incomplete actions remain unavailable in the interface.
- Financial rules are enforced from the contract foundation onward. Simplify asset coverage, screens, and data sources rather than weakening backing, authorization, settlement, or expiry guarantees.
- New functionality belongs in the existing modules and runtime boundaries. Adding an adapter or background task does not imply adding another deployed service.
- Local fixtures exercise the real program and remain visibly distinct from official assets. External market/context providers cannot become prerequisites for local startup or for exercising an active agreement; exercise still requires chain access and transferable assets.

## Stage sequence

| Stage                               | Working result                                                                                              | Prerequisite                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1. Contract foundation              | Repeatable financial scenarios executed against the settlement program.                                     | Product terms and settlement rules from the architecture.  |
| 2. Minimal local application        | A holder can activate and exercise a funded test offer through the browser.                                 | Contract foundation passes its acceptance gate.            |
| 3. Complete local product           | Holders and writers complete all core journeys through the interface.                                       | Browser-to-contract flow and local startup work reliably.  |
| 4. Official asset integration       | Asset discovery and context use verified sources and network-specific eligibility rules.                    | Complete local journeys and stable application boundaries. |
| 5. Recovery and release reliability | The application preserves financial correctness through restarts, stale data, and interrupted transactions. | Complete journeys and external adapters are testable.      |
| 6. Deployment and operation         | Reproducible local and hosted deployments with verified configuration and recovery procedures.              | Integrated behavior and failure recovery pass their gates. |

Stages are cumulative. Preparation for later work may proceed independently, but integration depends on the stated prerequisite. Optional market context is outside the core sequence.

## 1. Contract foundation

**Working result:** a reproducible scenario runner creates, activates, exercises, cancels, and expires agreements on a controlled test ledger. A browser and application backend are unnecessary for this result.

**Scope**

- Establish program boundaries, account identities, explicit agreement versioning, and agreement states, with a machine-readable interface suitable for generating application clients. Separate economic terms from authorization checks without implementing unused financial variants.
- Implement the full financial lifecycle: isolated payout funding, separate USDC premium payment, holder authorization, full exercise, cancellation before activation, expiry recovery, and terminal cleanup.
- Enforce asset admission and lifecycle limits for new commitments while preserving active terms. Start with a deliberately small supported fixture set.
- Include representative issuer behavior from the beginning: gross token delivery, transfer fees, scaled display amounts, transfer restrictions, and the settlement account's handoff to the writer. Test fee and display-scaling changes after activation against the fixed obligation.
- Provide shared, versioned fixture recipes and the fast test entry point defined in the [test-environment contract](architecture.md#test-environment-and-entry-points). Isolate each scenario and control chain time and epochs for boundary tests. Automated contract checks begin here and remain required throughout the pipeline.

**Verification**

Run both successful paths and rejected actions: insufficient backing or delivery balance, incorrect signer or asset, early reserve withdrawal, repeated or partial exercise, activation/cancellation races, exact expiry boundaries, and arithmetic limits. Verify that policy changes cannot rewrite active rights, fees cannot reduce the promised USDC payout, and a failed transfer rolls back the entire operation. Include donated surplus and cleanup restrictions so account housekeeping cannot block settlement or refunds.

Build with the pinned program toolchain and verify transaction size, compute, memory, and nested-call limits for the largest supported token configuration. Atomic settlement must fit a transaction format supported by the runtime and intended wallets.

**Acceptance gate:** the writer can disconnect after activation and the holder can complete atomic settlement, including control of the delivered tokens passing to the writer. The proof must cover the intended Token-2022 settlement path; a simplified token substitute alone does not pass. Both unused expiry and cancelled-offer recovery preserve the correct balances. Every admitted fixture configuration has an executable compatibility test.

## 2. Minimal local application

**Working result:** one local startup launches a small browser application connected to the tested contract. A holder activates a seeded funded offer and exercises it using disposable test assets.

**Scope**

- Connect a minimal backend and frontend through stable application interfaces and the architecture's [extension boundaries](architecture.md#business-changes-and-extension-boundaries). Generate the program client from the contract interface and keep HTTP types aligned with the backend contract; introduce replaceable interfaces at external boundaries rather than around every module.
- Add the local ledger and an idempotent initialization job that deploys the program, initializes policy, and prepares test participants and funded offers through real program instructions.
- Expose network identity, one supported fixture position, funded offers, agreement terms, and transaction outcomes. Store a minimal rebuildable projection of chain state, applying versioned migrations before readiness, and reconcile it from authoritative accounts on startup and after transactions.
- Support wallet signing, transaction submission, and confirmation in the browser; the backend never signs financial actions. Clearly distinguish pending, provisional, finalized, and failed outcomes. Persist public pending identifiers across tab closure, serialize signing across tabs, and reconcile expired signatures against finalized agreement state before offering a retry.
- Serve the frontend and API together. Add PostgreSQL with persistent storage, an application role, embedded migrations, and separate chain and index readiness. Local initialization and disposable signers require the expected local ledger identity and remain isolated from live configuration.
- Add the full test entry point with an isolated ledger, database, and browser environment per run. Use the real compiled program and disposable wallet signatures; share the same fixtures and runner between local development and CI, with failure artifacts and scoped cleanup.

**Verification**

Start from a clean checkout using the documented local entry point without mandatory environment variables. Complete activation and exercise through the browser, then verify balances and agreement state on the ledger. Reject wallet/network mismatch and wallet-signature rejection without showing success. Restart the environment without duplicating deployments, offers, or balances. Check that the generated client executes the same contract interface tested in Stage 1. Repeat the automated run from fresh state and alongside a manual demo to verify isolation, useful failure evidence, and cleanup that leaves the demo untouched.

Verify strict dependency and generated-client checks, supported interface versions, and explicit account resolution. Prove HTTP-only submission/confirmation and lossless financial values through the RPC proxy. Check the rendered test configuration for inherited host ports and live resources, and execute wallet signing from the test browser's secure origin.

**Acceptance gate:** the primitive works end to end without manually editing the database or configuring separate frontend and backend deployments. Cancellation and expiry remain executable through the scenario runner even before their full interface exists. Existing agreements survive an ordinary restart. A database/index outage leaves verified chain transport and direct agreement reads usable; index readiness identifies degraded discovery.

## 3. Complete local product

**Working result:** both participants can complete the entire product workflow through the application using local assets. Fixture provisioning supplies balances and asset policies; the writer can create new offers without fixture scripts.

**Scope**

- Complete position discovery, exact-quantity offer selection, offer review, active protection, and writer commitments.
- Let writers set terms, fund offers, cancel unaccepted offers, inspect committed capital, reclaim expired reserves, and locate delivered tokens.
- Match existing funded inventory against the selected asset, quantity, holder restrictions, and acceptable terms. Preserve each offer's fixed terms; distinguish no matching offer from an unavailable lookup.
- Show premium, payout, deadlines, gross delivery, estimated net receipt, transaction costs, and issuer restrictions before signing. Exercise remains an explicit holder action.
- Cover loading, empty, rejected, expired, and completed states, including balances split across token accounts and insufficient deliverable holdings.

**Verification**

Run complete holder and writer journeys with separate wallets. Exercise after the writer disconnects; separately allow protection to expire and reclaim the reserve. Verify cancellation races, designated-holder restrictions, no-match behavior, full-quantity requirements, and the inability to withdraw an active reserve. Check that a falling displayed price cannot trigger exercise and that the UI explains costs and deadlines correctly. Validate basic keyboard access and usable layouts for the core journeys.

Repeat clicks, switch wallets during preparation, and exercise component remounts. These must not duplicate submission, reuse another account's request results, or present retained stale data as a fresh observation.

**Acceptance gate:** every core action described in the product is reachable through the interface and has a visible, accurate outcome. The application needs no operational scripts for routine holder or writer actions, and every displayed success is supported by chain state.

## 4. Official asset integration

**Working result:** the application can recognize official PreStocks assets on their actual network and present validated issuer context. The complete local product continues to run independently with labelled fixtures.

**Scope**

- Add official asset and market-context adapters behind the existing boundaries. Validate response shape, provenance, freshness, and missing values.
- Bind supported assets to exact network and token identities. Apply admission rules for issuer extensions, transfer behavior, and lifecycle deadlines.
- Present market values separately from contractual payouts. Enable derived valuations only when price units and display units are verified.
- Extend compatibility fixtures for each newly admitted token configuration. Keep policy evidence and critical on-chain admission limits consistent.
- Provide explicit unsupported, stale, and unavailable states. Source failures can disable dependent context or new admission without introducing an exercise veto.

**Verification**

Test captured provider responses, missing or changed fields, unit mismatches, timeouts, rate limits, and stale observations. Use read-only checks against official network accounts to verify identity and configuration. Reproduce relevant token behavior on the local ledger and rerun the settlement suite. Verify that shortened policy limits block unsuitable new agreements without rewriting active ones. Never infer an official test-network asset from a mainnet address.

**Acceptance gate:** each admitted asset has verified identity, supported transfer semantics, valid lifecycle policy, and traceable context. Fixture integration and official-asset evidence remain distinguishable. Unsupported assets remain unavailable; they do not prevent the application from serving supported assets or existing agreements. Network-facing reads are verified here; live transaction release follows the deployment gate.

## 5. Recovery and release reliability

**Working result:** complete journeys remain correct when application state, external data, or transaction feedback is interrupted. Basic restart behavior from Stage 2 is extended into deliberate failure recovery.

**Scope**

- Complete bounded reconciliation of agreements, reserves, and token accounts. Treat local storage as a recoverable projection, with explicit observation freshness.
- Resolve uncertain transaction outcomes before offering a retry. Keep confirmed feedback separate from finalized records and avoid duplicate financial actions.
- Support compatible schema changes, repeated initialization, and clear failure on incompatible deployment state. Never repair incompatibility by silently resetting balances.
- Add actionable health and readiness signals, request correlation, dependency failures, and reconciliation lag without exposing secrets.
- Extend the shared test harness with scripted dependency failures and interrupted-response scenarios. Complete the combined automated checks for contract behavior, interfaces, application flows, startup, and recovery; keep default scenarios independent of live providers.

**Verification**

Interrupt submission and confirmation, repeat requests, restart the application during activity, and make the RPC or market source temporarily unavailable. Rebuild projections after deleting the local cache and recover the same authoritative financial state; cached market history is a separate concern. Exercise through an independent compatible client while the backend is unavailable. Test both a clean installation and an update with existing data and agreements.

Reload or navigate away with a transaction pending, recreate the application container while the browser remains open, and recover through public transaction identifiers. Test oversized/chunked responses and rate-limit delays against whole-operation bounds. Run migration and interrupted-write scenarios on isolated PostgreSQL databases with production settings. Verify migration locking, concurrent startup, monotonic checkpoints, and recovery after database unavailability.

**Acceptance gate:** interrupted feedback cannot produce a duplicate payment or false completion, and recovery does not alter rights or balances. Supported upgrades preserve earlier flows; incompatible state produces a diagnosable failure. Operators can distinguish unavailable dependencies, stale observations, and actual transaction failures.

## 6. Deployment and operation

**Working result:** a versioned release can run locally or as a hosted application against a deliberately configured external deployment. Local development retains its single-command entry point.

**Scope**

- Build reproducible artifacts with pinned dependencies and matched program, client, API, and network configuration. Promote tested artifacts rather than rebuilding untracked variants for deployment.
- Add the live deployment configuration: the application connects to the declared program and assets; local ledger services, fixture routes, and disposable signers are excluded.
- Separate application startup from explicit program deployment and upgrades. Verify network and program identity before enabling transactions; keep deployment authority outside the application runtime.
- Configure hosting, persistent application data, health checks, and minimal operator settings. Document deployment, compatible application rollback, cache recovery, and diagnosis of failed initialization.
- Assign responsibility for release execution and operation, with separate review of contract changes and deployment/upgrade authority. Complete the live-use reviews required by the architecture before exposing real-asset transactions.

**Verification**

Rehearse installation and updates using the release artifacts, then verify hosted health, identity, assets, and read paths without spending live funds. Prove that local-only facilities are absent from the live build and that operator credentials stay server-side. Rehearse application rollback against compatible persisted data and the declared program version. Check how new commitments can be disabled while preserving valid exercise of active agreements.

Build host and program artifacts with their respective pinned compilers and unchanged lockfiles. Verify the pinned PostgreSQL version, runtime health probes, standalone live configuration, backup/restore, and compatible schema replacement. Check browser cache headers and recovery from an outdated frontend asset without losing pending-action tracking.

**Acceptance gate:** the release is reproducible, identifiable, observable, and recoverable within documented limits. A release must not proceed with an identity mismatch, missing readiness, broken existing flows, or no compatible recovery path. Application rollback does not undo chain transactions, program upgrades, or incompatible data migrations; those require a separately reviewed recovery or forward-fix procedure.

## Runtime and delivery evolution

| Stage | Runtime and Compose evolution                                                                                                                                                                                                     | Automated checks added                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1     | Reproducible contract build and scenario runner; no persistent application services required.                                                                                                                                     | Contract lifecycle, invariants, supported token behavior, and reproducible fixtures.                 |
| 2     | Compose adds the local ledger, one-shot initialization, and PostgreSQL, and one application service containing the backend and frontend. Volumes, startup ordering, and readiness are part of this first application environment. | Generated-interface compatibility, clean startup, ordinary restart, and the browser settlement flow. |
| 3     | The same services gain complete product modules. No separate frontend server or matching service is needed.                                                                                                                       | Complete holder/writer journeys and meaningful interface failure states.                             |
| 4     | Source adapters run inside the application. Network-specific configuration is added; the local default remains independent of external providers.                                                                                 | Provider parsing, identity, policy, unit mapping, and expanded token compatibility.                  |
| 5     | The same runtime gains full reconciliation, diagnostics, and recovery checks. Background work remains inside the application.                                                                                                     | Interrupted transactions, dependency failures, reconstruction, and compatible updates.               |
| 6     | Local Compose retains its services. Live Compose connects the application to PostgreSQL and external chain infrastructure; hosting provides HTTPS.                                                                                | Release-artifact validation, live-build isolation, deployment smoke checks, and rollback rehearsal.  |

Contract checks run natively in LiteSVM; optional container packaging supplies reproducible build tools for CI. The validator container joins the complete localnet application environment in Stage 2. Deployment preparation is continuous; the final stage adds operational release capability. Every new runtime dependency must have a clear responsibility that the existing architecture cannot already satisfy. Configuration keeps committed defaults and the minimal operator settings defined in the architecture.

## Extending the pipeline

An additional capability enters through its owning boundary, brings a demonstrable user outcome, and adds tests for its new failure modes. A new asset repeats the admission and compatibility gate; a contract change repeats financial verification and client compatibility; a storage change repeats update and recovery checks. Preserve active agreement semantics across every increment.

Classify a business change before extending the system: presentation or provider changes stay within application boundaries; new economic or authorization rules follow [agreement evolution](architecture.md#agreement-evolution); additional runtime capacity follows measured bottlenecks. Require cross-version decoding and behavior tests when supporting more than one agreement version, and define migration or continued service for earlier agreements. A capability such as transferring a right enters as its own bounded product increment, with authorization and settlement tests, rather than as a configuration switch or speculative module.

Optional context, including Pyth, follows the official-data integration boundary only when its access, units, and product value are established. It must work as an isolated addition whose absence does not block core journeys, local startup, or settlement. Changes to the financial model or deployed service boundaries require an explicit product and architecture update before entering this pipeline.

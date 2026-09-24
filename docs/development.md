# Development

The contract checks exercise the settlement rules in the [architecture](architecture.md#4-on-chain-agreement). They load the compiled SBF program into LiteSVM, verify real signatures, and execute the token programs. No wallet configuration, RPC provider, API key, or funded account is required.

## Run the checks

From the repository root, run the checks directly on the host:

```sh
./tools/test fast
```

This executes the compiled SBF program inside LiteSVM, with isolated accounts and controllable chain time for each scenario. Docker and a running validator are unnecessary for these contract checks. A separate `solana-test-validator` serves RPC-based application integration tests; it is not a prerequisite for the LiteSVM suite.

Host execution requires Rust 1.98.1 through rustup, Anchor CLI 1.0.2, cargo-build-sbf 4.0.0, Python 3, and native build prerequisites. It does not require dprint or shfmt. Install Cargo-based tools with the exact versions and `--locked`, as in the Dockerfile. The SBF build selects platform-tools v1.53 and the v0 instruction set independently of the host compiler. The first build downloads dependencies; subsequent checks reuse Cargo caches. Versions and resolution are recorded in the manifests, toolchain file, Dockerfile, and Cargo.lock.

With rustup installed, prepare the Rust tools from the repository root:

```sh
rustup toolchain install 1.98.1 --profile minimal --component clippy --component rustfmt
./tools/rustup/cargo install --locked --version 1.0.2 anchor-cli
./tools/rustup/cargo install --locked --version 4.0.0 cargo-build-sbf
```

Keep Cargo's installation bin directory on `PATH`. Install Python 3 and the native build prerequisites through the host package manager; the [Dockerfile](../Dockerfile) lists the Debian package equivalents. These tools are development dependencies and do not require a validator, RPC credentials, or an application environment file.

Pass a Rust test-name substring to focus the scenario run; linting, program build, and IDL checks still run:

```sh
./tools/test fast expiry_boundary
```

To supply the tools through Docker and include the CI formatting gate, run:

```sh
./tools/test docker
./tools/test docker expiry_boundary
```

The image builds the pinned tools and dependencies, checks formatting, and runs the contract checks. The runner then repeats the contract checks without network access. Each Docker invocation stores build output, the image identity, and scenario output under its own `artifacts/tests/contract.*` directory. Both modes call `tools/test-host`, name each contract check before executing it, and return a nonzero exit status on failure. CI uses the Docker mode to verify formatting and the packaged toolchain. Neither mode launches a validator or application services; those belong to the complete localnet environment.

## Formatting and code structure

Formatting is independent of local contract tests and remains mandatory in CI. Run it explicitly when editing repository files:

```sh
./tools/format --check
./tools/format --write
```

The first command checks without changing files; the second applies formatting. With no argument, the command checks. `rustfmt.toml` controls Rust formatting and `.editorconfig` sets whitespace conventions. [dprint](https://dprint.dev/config/) uses versioned plugins for Python, Markdown, JSON, TOML, YAML, and Dockerfiles. [shfmt](https://github.com/mvdan/sh) formats shell scripts, including extensionless commands. The Dockerfile installs the exact formatter versions for CI. To run formatting directly on the host, install dprint 0.57.4 with `./tools/rustup/cargo install --locked --version 0.57.4 dprint` and install shfmt 3.6.0 on `PATH`. These are prerequisites for `tools/format`, not `tools/test fast`.

Generated IDL and Cargo.lock retain their generators' formatting. Build artifacts and dependency directories are excluded at every nesting level. The IDL is checked separately against regenerated output.

Group an instruction's account constraints and handler in the same module. Share validation only when multiple operations use the same rule. Add tests to the scenario module that owns the behavior; introduce another module when the responsibility changes, regardless of test count. Shared support owns fixture construction, instruction builders, transactions, and ledger observations. Each test creates its own fixture and makes its financial assertions explicitly. The adversarial scenarios additionally cover signer and token-account substitutions, cross-agreement PDAs, initialization replay, and forbidden transitions across every agreement status. Rejected transactions must preserve complete relevant account snapshots; payer SOL transaction fees are excluded from rollback assertions. Avoid monolithic test files, global mutable fixtures, generic test frameworks, and scripts that generate executable scripts.

## Code and interface ownership

| Path                                 | Responsibility                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `programs/volaryn/src/lib.rs`        | Public instruction entry points.                                                                |
| `programs/volaryn/src/instructions/` | One operation per module, with shared policy operations and lifecycle validation.               |
| `programs/volaryn/src/state.rs`      | Versioned agreement, protocol configuration, policy, and instruction arguments.                 |
| `programs/volaryn/src/token.rs`      | Extension admission, custom account allocation, transfers, and authority handoff.               |
| `programs/volaryn/src/error.rs`      | Stable program error codes and messages.                                                        |
| `tests/contract/tests/contract.rs`   | Single integration-test entry point.                                                            |
| `tests/contract/tests/scenarios/`    | Lifecycle, admission, authorization, token extensions, atomicity, and recovery scenarios.       |
| `tests/contract/tests/support/`      | Disposable VM setup, token fixtures, SDK conversions, instruction builders, and ledger helpers. |
| `tests/fixtures/programs.json`       | Exact token-program source versions and SHA-256 digests.                                        |
| `packages/protocol/idl/volaryn.json` | Generated public program interface.                                                             |

Scenario modules are also test-name filters; for example, `./tools/test fast authorization::` selects authorization checks. The entire check sequence still runs before the selected scenarios.

After an intentional interface change, regenerate and review the IDL:

```sh
./tools/build-idl
cp target/idl/volaryn.json packages/protocol/idl/volaryn.json
./tools/test fast
```

The checked-in `tools/rustup/cargo` adapter routes repository Cargo commands through rustup, including on hosts where distro Cargo is not a rustup proxy. Commands without a toolchain selector use the pinned host compiler; explicit `+toolchain` selectors from Anchor or cargo-build-sbf select that compiler and Cargo together. The adapter sets `RUSTC`, `RUSTDOC`, and the matching subcommand search path only for its child process, keeping tools such as Clippy on the same compiler. Test and formatting commands scope this adapter to their own `PATH`; they never replace the user's tools. `tools/test-host` launches cargo-build-sbf directly so a parent host Cargo cannot override the SBF toolchain's executable search path.

Contract checks require neither the Solana CLI nor a validator. `Anchor.toml` pins only Anchor: setting its optional `solana_version` would make even IDL generation invoke the Solana CLI. The SBF compiler and platform tools are pinned independently by the test command and Dockerfile.

IDL generation uses the pinned stable host compiler. The locked Anchor CLI embeds an older IDL builder that injects `procmacro2_semver_exempt`, disabling the `proc_macro::Span` conversions required by the resolved Anchor macros on stable Rust. `tools/build-idl` scopes `CARGO_ENCODED_RUSTFLAGS=-Awarnings` to IDL generation to replace that injected flag while retaining Anchor's warning policy; [Cargo gives encoded flags precedence over `RUSTFLAGS`](https://doc.rust-lang.org/cargo/reference/config.html#buildrustflags). This does not affect SBF compilation or Clippy. Validate tooling changes with the CLI installed by the Dockerfile's exact `cargo install --locked` command: a distribution package reporting the same Anchor version can embed different dependencies.

The test command regenerates to `target/idl/` and compares against the committed file. It never silently updates the public interface. The contract and tests share generated Rust instruction types; frontend client generation consumes the published IDL through the stack's Codama boundary.

## Fixture and admission contract

Fixture recipe version **1** uses deterministic disposable participants, a fixed chain clock, six-decimal test assets, and isolated VM state per test. It initializes token balances, policies, and agreements through instructions. Deployment metadata establishes a disposable upgrade authority, which must authorize protocol initialization. These keys and mints are local test identities.

The underlying fixtures cover all 16 combinations of transfer fees, scaled UI amounts, pausing, and a permanent delegate, including an ordinary Token-2022 mint with none of these extensions. A separate nine-decimal issuer fixture reproduces the reviewed PreStocks configuration: initialized default accounts, confidential-transfer and confidential-fee mint configuration, an inactive hook, metadata pointer, and token metadata alongside those four extensions. It uses transparent balances and real initialization instructions. Active hooks remain rejected. The settlement currency uses a configured six-decimal mint owned by the classic SPL Token program; Token-2022 settlement currencies are rejected. Adding another extension or currency behavior requires compatibility scenarios before admission. See [asset integration](asset-integration.md) for the reviewed profile and captured mainnet evidence.

`tools/prepare-fixtures.py` extracts SPL Token 3.5.0 and Token-2022 11.0.0 from the locked LiteSVM package and verifies their hashes. Tests explicitly load these artifacts instead of relying on LiteSVM's token-program defaults. LiteSVM's runtime feature set is tied to its locked release; these local fixtures do not establish compatibility with a particular live validator deployment.

The scenarios verify both offer origins, side-specific deposits, atomic payout funding and premium release, creator-only cancellation, wrong-side rejection, holder-only exercise, exact gross delivery and full payout, writer control of the delivered custom account, cancellation, expiry boundaries, and terminal cleanup. Failure cases cover unauthorized initialization, wrong accounts/signatures, stale policy, insufficient balances, repeat actions, issuer restrictions, unsupported hooks, and atomic rollback after an attempted delivery. Fee/scaling updates, donations, withheld fees, prefunded PDAs, and the full `u64` quantity range have explicit checks.

Every scenario transaction is checked against the legacy transaction size limit. The full exercise scenarios also enforce a 200,000 compute-unit budget; normal SBF execution enforces stack, heap, and nested-call limits. Financial checks keep signature and blockhash verification enabled. No fixture bypasses agreement authorization or edits financial state directly.

Terminal agreements remain allocated to prevent address reuse. Cleanup sweeps reserve surplus and hands over any remaining PDA-controlled underlying account. It does not automatically close token accounts or withdraw issuer-owned withheld fees; the terminal beneficiary can use ordinary token instructions after handoff: the creator after cancellation, or the writer after exercise/expired reclaim. Freezing or dust in the underlying account cannot become a prerequisite for a reserve refund.

## Run the local application

**Connect wallet** in the header or wallet panel, and each page's connection button, open the same labelled modal without changing the route. Choose **Test Wallet 1** or **Test Wallet 2** from that dialog for the local demo. These providers appear only in localnet builds and need no wallet configuration. The chooser also discovers installed Solana Wallet Standard providers; providers that do not support the deployment's chain or transaction signing remain disabled. On mainnet, Phantom is discovered when installed or has an installation link. WalletConnect QR pairing is available only for a configured mainnet build; see [optional WalletConnect pairing](deployment.md#optional-walletconnect-pairing).

Connection errors stay inside the chooser. **Close** or Escape dismisses it and restores focus to its trigger. Cancelling a pending connection prevents a later approval from selecting that wallet. Connecting does not sign or submit a transaction; the existing terms review remains the transaction approval step.

The [demo walkthrough](demo.md) provides the two-wallet sequence and expected settlement outcomes. PreStocks balances, filters, offer inputs and reviews use **unscaled token units**: raw base units divided only by the mint's decimal precision. They do not automatically convert issuer-scaled amounts copied from another wallet. Each review also shows the exact integer base-unit delivery obligation. USDC remains denominated in ordinary six-decimal USDC units.

Each holding's **Find protection** link selects its exact settlement mint in **Explore offers**. Offer filters live in the URL, so a copied link, reload, Back and pagination preserve the same criteria. The plain **Explore offers** navigation link starts a new unfiltered search. **Token identity → Verified issuer context** opens the official catalogue filtered by the asset's mainnet reference mint. From a signing review it opens a separate tab, leaving the reviewed terms unchanged. Mainnet reference links never switch the settlement network or request a signature.

```sh
docker compose up --build
```

Open `http://localhost:8080`. **Test Wallet 1** is the holder and **Test Wallet 2** is the capital provider. Disconnect to change roles. The home page explains the price floor specifically for PreStocks tokens. Its illustrative example shows the token quantity, fixed payout and equivalent unit price, premium, and expiry; it is not a live offer. Exercise requires delivery of the agreed quantity before expiry, and costs remain separate from the gross payout. Open **Explore offers** (`/offers`), search for a PreStocks token, then choose **View offer** to inspect a payout-backed buy offer or premium-escrowed sell request and accept from the opposite role. Open **Create offer** (`/offers/new`) to create additional offers without operational scripts. Select a PreStocks token and set quantity, payout, premium, UTC deadlines, and an optional designated counterparty. **Request protection** is the default and escrows the premium; **Provide protection** reserves the full payout. The opposite role accepts; self-acceptance is unavailable. **All offers / Sell requests / Buy offers** filters the market by origin. The holder uses **Explore offers** to match terms and **My portfolio → My protection** to find purchased rights. **My portfolio → My offers** lists writer commitments, whether created directly or accepted from a holder request. Holder-created requests appear under **My protection**, with awaiting-capital states distinct from active protection. **All** is the default portfolio view and combines both roles for the connected wallet. The independent status selector includes completed and expired agreements, preserves its selection across role changes, and survives reload and Back through the URL. Actions appear on each agreement's detail page. The creator can cancel an unaccepted request or offer and recover its initial premium or payout; the writer can reclaim unused reserves after expiry. Residual recovery belongs to the creator after cancellation and to the writer after exercise or expired reclaim. For the disposable local wallets, **Confirm and sign** is the only approval: the application rechecks the reviewed conditions, signs and submits without a second dialog or browser popup. **Back** or Escape closes the terms review without signing. Disconnecting during signing prevents the pending signature from being returned. External wallets use their own signing interface. All identities, assets, and balances are disposable fixtures, including the six-decimal settlement currency labelled USDC.

Each review shows exact gross quantity, premium, payout, deadlines, current issuer fee and estimated net receipt, estimated SOL network fee, new-account rent, and issuer restrictions. Conditions are reread before signing. Amount inputs use exact decimal parsing; one unscaled PreStocks replica unit is one billion base units (nine decimals), while one test USDC is one million base units (six decimals). Display scaling does not change contractual quantities. The creation form shows holdings of the selected PreStocks replica, including frozen amounts. Those holdings do not limit the quantity a writer may offer to buy: the writer reserves USDC. The funding selector shows the selected account's available USDC, required deposit, and remaining balance or shortfall. A holder request requires the premium; a writer offer requires the payout. **Use full USDC balance** sets the premium in request mode or the payout in provider mode; review the resulting terms before signing. Acceptance requires the holder's premium for a buy offer, or the writer's full payout for a sell request before releasing its premium, while exercise shows the full token delivery requirement against one selected account. Loading and unavailable balances remain explicit; retained observations are labelled last known and unavailable observations block financial actions. Each transfer uses one selected token account. Each token card shows its individual accounts and frozen holdings directly, including delivered settlement accounts under the writer's ownership. A total across accounts does not authorize delivery from an account with insufficient funds. Indexed lists can lag a newly finalized offer until the next discovery pass; its direct agreement URL reads finalized chain state without waiting for the index. Before finalization, a missing account shows **No finalized agreement yet** and continues polling instead of reporting an outage. Transaction progress and its pending signature appear above the page content. API or RPC failures remain explicit errors and pause actions; missing data never authorizes another submission.

The first visit opens disconnected. Reloading restores the previously authorized wallet after deployment verification; an explicit **Disconnect** clears that preference. Public agreements are readable without a wallet; they are not personal holdings. **Your wallet** loads balances only for an explicitly connected or successfully restored account. The connected wallet address, available USDC, and **PreStocks demo balances** are visible directly. Compact token cards place the ticker, full asset name, and exact balance together, followed by full account addresses and any frozen amounts. USDC follows the same layout. Neither the holdings list nor individual cards require expansion. Only the token cards scroll inside the holdings list; the balance-unit and network notes stay below it. The desktop panel reserves room for its header and notes when fitting the list to the viewport. Multiple accounts show their individual amounts and frozen status; a single account shows its address without repeating the aggregate balance. The local wallet explanation is inline. The production presentation uses **Your PreStocks** and ordinary USDC labels. Both presentations render the connected wallet's observed on-chain amounts, with no substituted demo totals; supported deployment and network validation still apply. **Official assets** uses separate read-only cards with compatibility, source price values, lifecycle notices, and icon-anchored tooltips for mint and token-behavior details; opening them does not change card dimensions. Disconnecting hides personal balances. Only an agreement held by the connected address is labelled as its active protection. After reopening a page, the restored wallet resumes confirmation tracking; reconnecting does not sign or send another transaction. **My portfolio → Activity** retains all attempts started from confirmed reviews. New supported signed operations that pass server-side preflight are recorded in PostgreSQL before relay and can be recovered in another browser; unsigned attempts remain in this browser. See [offer lifecycle](offer-lifecycle.md) for states and failure recovery. The activity migration is additive and does not reset the ledger, balances, or agreement projection.

Available USDC appears once in **Your wallet**, in a prominent card above the PreStocks cards. The panel sits beside workspace pages on desktop and below their content on mobile. **View wallet** in the header links directly to the panel on **My portfolio** from any page; the header shows the connected address without repeating balances. It sums only unfrozen accounts for the deployment's settlement mint, using exact integer amounts. Localnet labels this currency **test USDC**. Missing observations show loading or unavailable states, never an invented zero; cached balances remain labelled last known after failure. Individual action forms continue to use the balance of their selected account.

On desktop, the wallet follows page scrolling and fits the available viewport: its identity and USDC remain above an independently scrollable PreStocks list. The panel measures available space and fixed content instead of assuming a header height. If the viewport cannot accommodate both the fixed content and a usable list, the panel returns to normal page flow. Mobile always uses normal flow with a bounded holdings list. Short lists keep their natural height. The list has a visible thin scrollbar, keyboard focus, and reachable account addresses and protection links; there are no extra disclosures for balances.

Wallet and agreement observations poll every three seconds; official context polls every thirty seconds. A background read preserves the displayed result, form values, focus, and controls instead of adding loading rows or hiding an empty list. Changed data appears when the response succeeds. Initial reads still show loading, and failures retain their warning and pause dependent financial actions throughout retries until recovery. New wallets and queries never reuse another identity's observations.

The interface keeps financial amounts, deadlines, costs, restrictions, unavailable-data warnings, and action eligibility visible. Optional inputs use the native **Details** disclosure: **More filters** reveals quantity/payout/premium criteria, and **Restrict to a wallet** reveals the optional counterparty restriction. Collapsed summaries retain applied-filter counts and a configured counterparty address; closing a section does not clear its values. Offer creation groups token selection, terms, and funding, with one primary review action. Signing reviews keep all costs and restrictions visible, with **Token identity** and **Transaction accounts** inline inside the already bounded review dialog.

Read-only context uses the shared **InfoPopover** component: official asset details and verified behavior, token identity outside signing reviews, agreement on-chain details, catalog transfer rules and provenance, and the local-demo explanation. Clicking or keyboard-activating an information button opens a compact tooltip beside it, with an arrow pointing to the button. [Floating UI](https://floating-ui.com/docs/react) handles anchoring, viewport edges, and updates on scroll or resize. Native auto popovers provide outside-click and Escape dismissal, one open tooltip at a time, and keyboard access to the contents. Clicking the trigger again or its close icon also dismisses it. The page stays interactive and scrollable, without a backdrop or card resizing. Long content scrolls inside the tooltip; its heading and close icon stay visible. Tooltips close when their trigger leaves the viewport or unmounts. Observation refreshes update an open tooltip without closing it. Copyable addresses and links use nonmodal dialog semantics for assistive technology. Names, balances, and essential transaction terms remain directly visible. Tooltip contents share `InfoContent.module.css`: short section headings, aligned label/value rows, separate full-address blocks, source-status badges, extension tags, and distinct explanatory or warning notes. Exact source values and UTC limits remain readable without truncation; styling does not imply a price unit or token valuation.

The interface uses a dark palette with [Solana's official purple and green](https://solana.com/branding) (`#9945FF` and `#14F195`) and a blue transition in decorative gradients. Shared color and card-spacing tokens live in `frontend/src/styles.css`; component styling lives in adjacent CSS modules. Cards use 10–16px padding and grow with their content; names and values share a row where space permits. Wallet balance cards have an opaque raised background and distinct borders to separate each asset from the surrounding panel; USDC retains a green tint. Keep vertical gaps compact without reducing type sizes, clipping financial information, or shrinking primary controls and disclosure targets below 44px. Body text, financial values, warning/error states, and disabled controls use solid colors for readability.

No `.env` file is required. Compose runs PostgreSQL, the validator, an initialization job, and one non-root application process serving React and the HTTP API. PostgreSQL uses a persistent named volume and creates a separate `volaryn` application role without superuser, role-creation, or database-creation privileges. Local credentials are public disposable fixtures, not hosted-deployment credentials. Only the application port is published, on loopback. The pinned validator archive targets Linux amd64; other host architectures require Docker's amd64 emulation. The first build downloads pinned tools, dependencies, and browser binaries for the test target.

Compose invokes `solana-test-validator` directly with visible arguments. Its `--bind-address validator` resolves the service's current container IP through Compose DNS; Agave 4.0.3 rejects the unspecified address `0.0.0.0` when constructing gossip contact information. RPC still listens on all container interfaces, so both the loopback health check and other services can reach it. No validator ports are published to the host.

The validator uses a [committed seccomp profile](../tools/localnet/seccomp/README.md) that adds the three io_uring calls required by Agave to Moby's default policy. It remains non-root and does not need privileged mode. The Docker host must support io_uring. The container streams validator logs through `docker compose logs validator`; the local logging driver rotates them at 10 MB with three files retained.

If the validator exits before readiness, read `docker compose logs --no-color --tail=150 validator`. An `io_uring_supported()` panic requires checking kernel support, syscall permissions, and locked-memory limits; `UnspecifiedIpAddr(0.0.0.0)` means the validator received an invalid bind address. Compose supplies the executable, arguments and seccomp profile. Read the failing service's logs before choosing a repair; an RPC or host configuration error does not require a data reset.

The validator loads the compiled upgradeable program and pinned token programs into a new genesis. Bootstrap verifies the program hash, records the genesis and fixture identity in a public manifest, then creates the settlement mint, eight PreStocks replica mints, their policies and accounts for both participants, balances, and two funded offers through transactions. Both test wallets start with 10,000 test USDC and 100 unscaled units of each of the eight replicas. The two seeded offers reserve 20 test USDC each from Test Wallet 2, leaving 9,960 available at first startup. These interactive balances are independent of the smaller contract-test balances. An existing ledger is resumed; bootstrap reuses compatible accounts and never replaces an exercised or expired offer. A partially completed bootstrap resumes through its pending manifest. Incompatible identity fails explicitly.

On a fresh ledger, bootstrap waits for transaction finalization before using dependent accounts. Independent participant funding and the eight asset initialization sequences run concurrently; USDC, protocol configuration, and offer funding retain their dependency order. Initialization can take several minutes after the validator becomes healthy. Compose waits for this job to exit successfully before starting the application. Follow `docker compose logs -f bootstrap` for the current operation, a waiting message every ten seconds during transactions, and completion times. Reusing an initialized ledger skips the creation transactions. Bootstrap source changes require rebuilding its image; `--no-build` continues to use the previously packaged code.

Local replica admission has no calendar cutoff: bootstrap uses the maximum supported signed timestamp for its review and expiry limits. Each offer still has its own acceptance and exercise deadlines. Bootstrap creates missing policies and leaves existing policies unchanged, including disabled or deliberately revised policies. It does not convert historical fixtures. This rule belongs only to disposable local fixtures; mainnet admission and contract expiry checks are unchanged. Bootstrap prints its ledger identity; it must equal `genesisHash` from the running application's `/api/config`.

To refill an existing demo, explicitly run bootstrap with `--top-up`. It mints only the shortfall up to 10,000 test USDC and 100 unscaled units of each replica in each wallet's fixture accounts. Balances already above those targets remain unchanged; repeated top-ups do not add more. Ordinary startup preserves spent balances. Existing agreements, their reserved funds, and token identities are retained. Use the same Compose project name as the running environment (for example, add `-p volaryn-prestocks` after `docker compose`):

```sh
docker compose build bootstrap
docker compose run --rm --no-deps bootstrap \
  node_modules/.bin/tsx tools/localnet/bootstrap.ts \
  --rpc-url http://validator:8899 --manifest /deployment/deployment.json \
  --program /fixtures/volaryn.so --top-up
```

For native localnet, use `npm run localnet:bootstrap -- --rpc-url <local-validator-url> --manifest target/localnet/deployment.json --top-up` while that validator is running. Top-ups issue actual local-chain mint transactions; the interface displays the resulting finalized balances.

```sh
docker compose down       # stop services; retain ledger and application data
docker compose up         # resume the same agreements and balances
```

Use the same Compose project for repeated development. After an incompatible program, manifest or schema change, follow [local development reset](#local-development-reset). Rebuilding an image alone does not replace the program stored in the ledger.

Backend CLI arguments select the manifest, upstream RPC, static files, and listening address. PostgreSQL uses `DATABASE_URL` (or `--database-url`); prefer the environment to keep credentials out of command arguments. Compose and the native launcher supply the local connection automatically. The application accepts fixture manifests only when built with the `localnet` feature, verifies genesis and program bytes, and applies embedded migrations before listening. The index discovers account addresses every thirty seconds and refreshes open/active agreements every two seconds, with up to four concurrent batches of fifty agreement/reserve pairs. Each pair uses one finalized RPC context; stale slots cannot replace newer rows.

`/health/live` reports process liveness. `/health/ready` verifies chain identity independently of PostgreSQL, with a shared five-second identity cache. `/health/index` additionally requires reconciliation within thirty seconds and a database query within two seconds. An index outage disables list queries; verified read-only `/rpc`, configuration, balances, and direct agreement reads remain usable. New tracked submissions require PostgreSQL to record their receipts before forwarding. A direct read allows the database up to 500 ms before falling back to Solana. The pool reconnects and the worker restores index readiness when dependencies recover. Initial startup still requires the database for migrations. The runtime image's `volaryn --healthcheck` probes transport readiness; full environment launchers wait for index readiness.

The browser uses the same-origin `/rpc` route for wallet submission and HTTP polling. The proxy restricts RPC methods, preserves upstream number text and error envelopes, bounds request/response sizes, and sets a whole-request deadline. It has no airdrop or administrative route. Signature, owner, agreement, origin side, actor role, operation, and block-height lifetime persist in local storage across tab closure, keyed by genesis, program, and wallet. Creation records also retain the selected mint and public immutable offer terms so recovery can verify the intended effect. Web Locks prevent concurrent signing in another tab; storage/locking failures fail closed. Private keys and signed transaction bytes are not retained. Confirmed results remain provisional; finalized signature status or a version-specific finalized agreement effect resolves an expired action. Missing signature history alone cannot establish failure. Clearing browser storage removes the recovery record. No replacement is signed automatically.

## Native local application

With the pinned Rust/contract tools, Node, Agave 4.0.3, and PostgreSQL 17.11 installed, prepare and run the persistent demo without containers:

```sh
./tools/test fast
npm ci
npm run build
./tools/rustup/cargo build --locked -p volaryn-backend --features localnet
npm run dev:localnet
```

Open `http://localhost:8080`. The launcher owns a loopback-only PostgreSQL cluster and Solana validator, supplies the database connection, initializes fixtures, and waits for application readiness. It fails if port 8080 or the persistent runner is already in use. Ctrl+C stops its processes and retains the ledger, manifest, database, and logs under `target/localnet/`. Run the same command to resume. Build changed Rust/frontend sources before restarting; this command does not run a watcher. Only this complete localnet environment needs a running validator; contract tests continue to use LiteSVM.

## Local development reset

Development maintains one current contract, manifest, generated client and database schema. Change them together; do not add historical decoders, conversion jobs or incremental migrations solely to retain disposable development data. Version identifiers and program fingerprints remain validation boundaries, not promises to support older formats.

After an incompatible change, recreate the local environment in the same Compose project:

```sh
docker compose down --volumes
docker compose up -d --build --wait --wait-timeout 600
```

This explicitly deletes the project's test ledger, manifest, database, balances and operation history, then initializes fresh fixtures. If the environment was started with `-p NAME`, use the same `-p NAME` on both commands. A new project name is not required for each change. Ordinary restarts preserve data; startup rejects incompatible state and never resets it automatically.

For native development, stop `npm run dev:localnet`, remove only the disposable `target/localnet/` directory, then rebuild and start using the commands under [native local application](#native-local-application). The automated localnet runner already creates an isolated environment per run. These reset procedures apply only to disposable localnet state, never to a live deployment.

## Database changes and recovery

Local launchers provision the database and restricted application role; the backend applies the schema before serving requests. No database connection is needed to compile code or export OpenAPI. Native tests allocate their own cluster and per-scenario databases, while container tests use an isolated Compose database service. `VOLARYN_TEST_DATABASE_URL` is an internal runner setting used only to create and remove owned test databases; it is not application configuration.

`backend/migrations/0001_initial_schema.sql` defines deployment identity, chain projections, reconciliation and durable activity receipts together. Edit this baseline for development schema changes and recreate the disposable environment using [local development reset](#local-development-reset). SQLx still validates applied checksums and serializes concurrent initialization; startup never erases a database or ignores a schema conflict. Tests cover fresh installation, repeated and concurrent startup, retained data and rejection of changed migration history.

Rebuilding observations cannot recover discarded off-chain history. For retained application data, take a PostgreSQL backup with `pg_dump` and rehearse `pg_restore` into a separate database before upgrading. Never delete volumes as a database repair. PostgreSQL major-version upgrades are deliberate operations, separate from application SQL migrations. Hosted deployment supplies its own restricted credentials and certificate-verified TLS in `DATABASE_URL`; do not reuse the public local fixture credentials.

## Application checks

Use Node **24.15.0**, its bundled npm **11.x**, and PostgreSQL **17.11** for native application checks. Install PostgreSQL through the host package manager with `postgres`, `initdb`, `pg_ctl`, and `psql` on `PATH`; a system database service is unnecessary. Run as an ordinary user because `initdb` refuses root. `.npmrc` enforces engine and peer compatibility; `npm ci` uses the committed lockfile. For native backend/frontend checks without a validator:

```sh
./tools/test app
```

This checks Clippy, real PostgreSQL migrations, concurrent startup, numeric precision, rollback, and HTTP boundaries, exported OpenAPI drift, generated program/HTTP clients, TypeScript, ESLint, frontend unit tests, and frontend builds. Formatting is a separate command, consistent with the native contract suite:

```sh
npm run format:check
npm run format:write
```

Prettier owns TypeScript, JavaScript, CSS, and HTML. `tools/format` owns Rust, shell, Python, Markdown, JSON, TOML, YAML, and Dockerfiles. Both gates run in the container build used by CI. Generated program code, HTTP types, IDL, OpenAPI, and lockfiles keep their generators' output; regeneration checks their compatibility.

For the complete isolated environment and browser checks:

```sh
./tools/test full
```

The runner builds the contract and application with their checks, then starts a unique Compose project with its own ledger, deployment manifest, and PostgreSQL volume. Backend integration tests run against that server with separate databases before the application starts. The rendered configuration is checked for inherited host ports and external volumes. A loopback forwarder inside the browser-test container supplies a secure browser origin without publishing ports or requiring WebSockets. The default demo can remain running.

Playwright checks direct signing after terms confirmation, closing the review with Back or Escape without submission, duplicate-click protection, and blocking a changed network before signing. It activates through real wallet signing, reopens the tab and reconnects while confirmation is pending, and exercises without the writer. It checks finalized agreement state, gross delivery, issuer fees, full USDC payout, reserve depletion, and writer ownership of the delivered account. Holder-origin scenarios create requests, fund them from the opposite wallet, refund unmatched premiums, and settle the resulting protection. Writer scenarios select **Provide protection** to create offers through the browser, cancel and recover terminal funds, match exact terms with a separate holder, verify delivered-account ownership, and wait for real validator expiry before reclaiming. Separate interface scenarios verify a disconnected home page does not load offer discovery or personal holdings, desktop/mobile navigation between browsing, creation and portfolio, direct agreement links, wallet-scoped portfolio history, explicit connection, silent reconnection after reload, balance removal on disconnect, operation-history recovery, wallet loading/empty/error states, split-account delivery limits, ownership-aware presentation, and wallet changes during preparation. Recovery checks restart PostgreSQL and the validator/application, repeat bootstrap, and rebuild the chain projection while retaining identical financial state. Test cleanup removes only that run's project and volumes. Logs, browser traces on failure, screenshots, and rendered configuration remain under `artifacts/tests/localnet.*`.

For the same browser and recovery checks directly on the host, install Agave **4.0.3**, PostgreSQL **17.11**, Node, the Rust tools above, and Playwright Chromium, then run:

```sh
./tools/test fast
./tools/test app
./tools/rustup/cargo build --locked -p volaryn-backend --features localnet
npx playwright install chromium
npm run test:localnet
```

The native runner allocates separate ports and an artifact directory, starts its own PostgreSQL cluster, validator, and backend, and shuts down only those processes. It also stops PostgreSQL while the application stays running, verifies index degradation while chain transport and direct agreement reads stay available, and restores the database before checking retained financial observations. It preserves evidence and ledger files under `artifacts/localnet/run-*`; PostgreSQL logs and owned cluster data remain under `artifacts/postgres/run-*`. It never uses the manual demo's data or an ambient `DATABASE_URL`. On systems using a packaged Chromium, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` may point to that executable. This optional test-runner setting is not application configuration. Fast contract and application checks remain independent of a validator.

Arguments after `--` are forwarded to Playwright for focused runs, for example `npm run test:localnet -- tests/browser/activity.spec.ts tests/browser/transaction-feedback.spec.ts`. Recovery checks still run after the selected browser scenarios. The result records `browserArguments`, so a filtered run is distinguishable from the complete browser suite.

## Application modules and interfaces

The **Official assets** page and `GET /api/assets/official` load issuer/mainnet observations on demand, independently of local chain readiness and the database. The optional server argument `--official-rpc-url` overrides the read-only mainnet endpoint; no API key or new environment variable is required. `inspect-assets` performs the same read-only verification without a validator or database. Source failure states, policy review, and commands are described in [asset integration](asset-integration.md).

| Path                          | Responsibility                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `backend/src/application.rs`  | Chain/index availability, direct reads, and reconciliation orchestration.                        |
| `backend/src/indexer.rs`      | Discovery scheduling and bounded account-pair reconciliation.                                    |
| `backend/src/queries.rs`      | Validated pagination and agreement filters shared by HTTP and storage.                           |
| `backend/src/observations.rs` | Public deployment and chain DTOs with exact decimal-string quantities and generated API schemas. |
| `backend/src/domain.rs`       | Typed application failures and chain-time helpers, independent of HTTP and storage.              |
| `backend/src/adapters/`       | Bounded Solana reads and transactional PostgreSQL projection storage.                            |
| `backend/src/http.rs`         | Typed REST endpoints, byte-preserving RPC proxy, health routes, and static delivery.             |
| `backend/migrations/`         | One current initial schema, embedded in the executable.                                          |
| `frontend/src/pages/`         | Product introduction, offer discovery, creation, portfolio views, and agreement detail routes.   |
| `frontend/src/features/`      | Account-scoped observations, persistent transaction journal, and finalized outcome recovery.     |
| `frontend/src/lib/`           | Generated API types, exact amounts, chain validation, and wallet client construction.            |
| `frontend/src/localnet/`      | Disposable Wallet Standard implementation, imported only by localnet builds.                     |
| `packages/protocol/src/`      | Generated Codama client plus explicit PDA resolution and HTTP transaction helpers.               |
| `tools/postgres/`             | Local role/database initialization and owned native cluster lifecycle.                           |
| `tools/localnet/`             | Fixture initialization and isolated environment/test lifecycle.                                  |
| `tests/browser/`              | Browser journeys and authoritative chain assertions.                                             |

Generate changed interfaces explicitly, review the output, then run both check suites:

```sh
./tools/build-idl
cp target/idl/volaryn.json packages/protocol/idl/volaryn.json
npm run generate:protocol
./tools/rustup/cargo run --locked --quiet -p volaryn-backend --bin export-openapi > packages/api/openapi.json
npm run generate:api
```

Client checks generate into temporary files and never rewrite checked-in interfaces. The IDL importer accepts the declared Anchor specification; unsupported versions fail. Explicit PDA helpers supply all instruction accounts, including policy derivations that Codama names differently across instructions. The browser execution test proves that generated instructions match the compiled contract.

`tests/fixtures/recipe.json` defines shared identities, quantities, and localnet token behavior. The Rust fixture verifies its test vocabulary against that recipe, while bootstrap and browser assertions consume it directly. Localnet uses the validator clock for offer deadlines; LiteSVM uses controlled time for exact boundary scenarios.

The application stores exact amount strings in typed JSONB projections and the finalized-slot checkpoint in bounded `NUMERIC(20,0)`. SQLx embeds migrations and validates their checksums under PostgreSQL migration locking. The initial schema defines per-agreement slots/timestamps, generated filter columns, and indexes directly. The worker upserts bounded batches without deleting existing records; rows and their high-water checkpoint commit atomically, and older slots cannot overwrite newer observations. List queries bind filters and use `after` address cursors with a default limit of 50 and maximum of 200; `X-Next-Cursor` identifies the next page. Detail reads query one primary key. Tests use the application role, retain the entire `u64` range, reject ledger mismatches and changed migration history, and exercise rollback and concurrent startup. Stop the previous application writer before any incompatible schema replacement. Preserve database backups and use a forward fix, or restore a separately verified compatible application/schema pair; reverting the binary alone is insufficient. An application rollback requires a compatible schema.

`npm run build:live` produces a separate frontend artifact. `npm run check:live` verifies exclusion of disposable wallet code and local-only presentation: the localnet banner, supplied-wallet prompts, replica explanations, and test-currency labels. These features require the explicit `localnet` build mode; no application environment toggle enables them in production. The production artifact rejects a localnet manifest before wallet registration or RPC access, so fixture funds cannot appear as live holdings. Neutral product components use ordinary wallet and USDC labels outside localnet. This is a build-isolation check, not an external-deployment command: external manifests and live trading remain subject to the deployment pipeline gate, and unsupported manifests are rejected.

## External deployments and release checks

Chooser regressions inject Wallet Standard providers through their public registration events to cover discovery after page load, rejected connections, incompatible chains, modal focus, and approval arriving after cancellation. These scenarios use controlled API responses and do not submit transactions. WalletConnect adapter tests use a mocked Sign SDK; external relay pairing and mobile wallet approval require separate validation with the configured deployment.

The public manifest uses schema 3. Local participant addresses and `fixtureVersion` are nested under `localnet`; external deployments omit that block. Both backend build features and frontend build mode reject the wrong deployment kind. Bootstrap accepts only the current manifest with exactly matching ledger, program, asset and participant identities. It checks both the published manifest and any interrupted `.pending` file, then atomically publishes the manifest after fixture verification succeeds. No historical format is converted.

A mismatch in identity or schema fails before overwriting the manifest. Follow [local development reset](#local-development-reset) for incompatible local state. The native full runner rehearses a same-format bootstrap restart with a pending manifest while preserving used balances, agreements and database history. Refilling balances still requires an explicit `--top-up`.

`python3 -m unittest discover -s tests/release` checks operator configuration and hosted smoke verification without Docker, credentials or external services. Backend deployment tests cover loader linkage, executable changes, authority drift, protocol currency, stale admission reads, release fingerprints, build isolation and secret-file errors. Run configuration tests with and without the `localnet` feature. `npm test` checks bundled artifact fingerprints; `tests/browser/live-build.spec.ts` serves the actual production frontend with controlled mainnet-shaped read responses and verifies navigation without disposable wallets. It requires `npm run build:live`, but no real mainnet deployment. `npm run test:localnet` additionally restores an actual PostgreSQL dump into a fresh database and exercises through the generated client with the application stopped. The Compose full test performs the same independent settlement boundary and compares its restored database with the source.

`./tools/release/build OUTPUT_DIRECTORY` requires a clean checkout and Docker. CI builds this target after the complete localnet suite. See [deployment and operation](deployment.md) for the release bundle, mainnet manifest, HTTPS host setup, image promotion and rollback limits. Building a release does not deploy or upgrade a program.

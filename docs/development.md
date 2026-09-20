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

Group an instruction's account constraints and handler in the same module. Share validation only when multiple operations use the same rule. Add tests to the scenario module that owns the behavior; introduce another module when the responsibility changes, regardless of test count. Shared support owns fixture construction, instruction builders, transactions, and ledger observations. Each test creates its own fixture and makes its financial assertions explicitly. Avoid monolithic test files, global mutable fixtures, generic test frameworks, and scripts that generate executable scripts.

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

The underlying fixtures cover all 16 combinations of transfer fees, scaled UI amounts, pausing, and a permanent delegate, including an ordinary Token-2022 mint with none of these extensions. The program admits only these extension types and rejects other mint extensions. An active transfer hook is a rejection fixture. The settlement currency uses a configured six-decimal mint owned by the classic SPL Token program; Token-2022 settlement currencies are rejected. Adding another extension or currency behavior requires compatibility scenarios before admission.

`tools/prepare-fixtures.py` extracts SPL Token 3.5.0 and Token-2022 11.0.0 from the locked LiteSVM package and verifies their hashes. Tests explicitly load these artifacts instead of relying on LiteSVM's token-program defaults. LiteSVM's runtime feature set is tied to its locked release; these local fixtures do not establish compatibility with a particular live validator deployment.

The scenarios verify full funding, separate premium payment, holder-only exercise, exact gross delivery and full payout, writer control of the delivered custom account, cancellation, expiry boundaries, and terminal cleanup. Failure cases cover unauthorized initialization, wrong accounts/signatures, stale policy, insufficient balances, repeat actions, issuer restrictions, unsupported hooks, and atomic rollback after an attempted delivery. Fee/scaling updates, donations, withheld fees, prefunded PDAs, and the full `u64` quantity range have explicit checks.

Every scenario transaction is checked against the legacy transaction size limit. The full exercise scenarios also enforce a 200,000 compute-unit budget; normal SBF execution enforces stack, heap, and nested-call limits. Financial checks keep signature and blockhash verification enabled. No fixture bypasses agreement authorization or edits financial state directly.

Terminal agreements remain allocated to prevent address reuse. Cleanup sweeps reserve surplus and hands over any remaining PDA-controlled underlying account. It does not automatically close token accounts or withdraw issuer-owned withheld fees; the writer can use ordinary token instructions after handoff. Freezing or dust in the underlying account cannot become a prerequisite for a reserve refund.

## Run the local application

```sh
docker compose up --build
```

Open `http://localhost:8080` and connect **Local test wallet**. Review the funded offer, activate protection, and exercise it. The wallet prompts for each signature. The writer has already funded the complete payout through the same generated instruction client used by the browser. All identities, assets, and balances are disposable fixtures, including the six-decimal test settlement currency labelled USDC.

The page opens disconnected, including after a reload. Public agreements are readable without a wallet; they are not personal holdings. **Your wallet** loads balances only after an explicit connection and shows the connected address and the origin of the provided demo balances. Disconnecting hides those balances. Only an agreement held by the connected address is labelled as its active protection. After reopening a page with a pending transaction, connect the same wallet to resume confirmation tracking; reconnecting does not sign or send another transaction.

The interface uses a dark palette with [Solana's official purple and green](https://solana.com/branding) (`#9945FF` and `#14F195`) and a blue transition in decorative gradients. Shared color tokens live in `frontend/src/styles.css`; component styling lives in `frontend/src/App.module.css`. Body text, financial values, warning/error states, and disabled controls use solid colors for readability.

No `.env` file is required. Compose runs PostgreSQL, the validator, an initialization job, and one non-root application process serving React and the HTTP API. PostgreSQL uses a persistent named volume and creates a separate `volaryn` application role without superuser, role-creation, or database-creation privileges. Local credentials are public disposable fixtures, not hosted-deployment credentials. Only the application port is published, on loopback. The pinned validator archive targets Linux amd64; other host architectures require Docker's amd64 emulation. The first build downloads pinned tools, dependencies, and browser binaries for the test target.

Compose invokes `solana-test-validator` directly with visible arguments. Its `--bind-address validator` resolves the service's current container IP through Compose DNS; Agave 4.0.3 rejects the unspecified address `0.0.0.0` when constructing gossip contact information. RPC still listens on all container interfaces, so both the loopback health check and other services can reach it. No validator ports are published to the host.

The validator uses a [committed seccomp profile](../tools/localnet/seccomp/README.md) that adds the three io_uring calls required by Agave to Moby's default policy. It remains non-root and does not need privileged mode. The Docker host must support io_uring. The container streams validator logs through `docker compose logs validator`; the local logging driver rotates them at 10 MB with three files retained.

If the validator exits before readiness, read `docker compose logs --no-color --tail=150 validator`. Older containers using the `--quiet` wrapper put errors in the ledger volume instead: `docker compose run --rm --no-deps --entrypoint tail validator -n 120 /ledger/validator.log`. An `io_uring_supported()` panic requires checking kernel support, syscall permissions, and locked-memory limits; `UnspecifiedIpAddr(0.0.0.0)` means the validator received an invalid bind address. Compose supplies the executable, arguments and seccomp profile, including for already-built images: apply changes with `docker compose up -d --no-build --wait --wait-timeout 300`. Keep existing volumes when diagnosing startup failures.

The validator loads the compiled upgradeable program and pinned token programs into a new genesis. Bootstrap verifies the program hash, records the genesis and fixture identity in a public manifest, then creates mints, policy, accounts, balances, and the funded offer through transactions. An existing ledger is resumed; bootstrap reuses compatible accounts and never replaces an exercised or expired offer. A partially completed bootstrap resumes through its pending manifest. Incompatible identity fails explicitly.

On a fresh ledger, bootstrap submits eleven transactions sequentially and waits for each to reach finalization, so initialization can take several minutes after the validator becomes healthy. Compose waits for this job to exit successfully before starting the application. Follow `docker compose logs -f bootstrap` for the current operation, a waiting message every ten seconds during transactions, and completion times. Reusing an initialized ledger skips the creation transactions. Bootstrap source changes require rebuilding its image; `--no-build` continues to use the previously packaged code.

```sh
docker compose down       # stop services; retain ledger and application data
docker compose up         # resume the same agreements and balances
```

To deliberately discard the disposable demonstration and obtain a fresh offer, use `docker compose down --volumes`, followed by `docker compose up`. This reset deletes the local ledger, manifest, and projection; it is never performed by application startup.

Backend CLI arguments select the manifest, upstream RPC, static files, and listening address. PostgreSQL uses `DATABASE_URL` (or `--database-url`); prefer the environment to keep credentials out of command arguments. Compose and the native launcher supply the local connection automatically. The application accepts fixture manifests only when built with the `localnet` feature, verifies genesis and program bytes, and applies embedded migrations before listening. The index discovers account addresses every thirty seconds and refreshes funded/active agreements every two seconds, with up to four concurrent batches of fifty agreement/reserve pairs. Each pair uses one finalized RPC context; stale slots cannot replace newer rows.

`/health/live` reports process liveness. `/health/ready` verifies chain identity independently of PostgreSQL, with a shared five-second identity cache. `/health/index` additionally requires reconciliation within thirty seconds and a database query within two seconds. An index outage disables list queries; verified `/rpc`, configuration, balances, and direct agreement reads remain usable. A direct read allows the database up to 500 ms before falling back to Solana. The pool reconnects and the worker restores index readiness when dependencies recover. Initial startup still requires the database for migrations. The runtime image's `volaryn --healthcheck` probes transport readiness; full environment launchers wait for index readiness.

The browser uses the same-origin `/rpc` route for wallet submission and HTTP polling. The proxy restricts RPC methods, preserves upstream number text and error envelopes, bounds request/response sizes, and sets a whole-request deadline. It has no airdrop or administrative route. Signature, owner, agreement, operation, and block-height lifetime persist in local storage across tab closure, keyed by genesis, program, and wallet. Existing session records migrate when the matching wallet connects. Web Locks prevent concurrent signing in another tab; storage/locking failures fail closed. Private keys and signed transaction bytes are not retained. Confirmed results remain provisional; finalized signature status or a version-specific finalized agreement effect resolves an expired action. Missing signature history alone cannot establish failure. Clearing browser storage removes the recovery record. No replacement is signed automatically.

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

## Database changes and recovery

Local launchers provision the database and restricted application role; the backend applies the schema before serving requests. No database connection is needed to compile code or export OpenAPI. Native tests allocate their own cluster and per-scenario databases, while container tests use an isolated Compose database service. `VOLARYN_TEST_DATABASE_URL` is an internal runner setting used only to create and remove owned test databases; it is not application configuration.

The SQLite-to-PostgreSQL transition creates a new PostgreSQL migration history and rebuilds agreement projections from the retained Solana ledger. Keep the same Compose project name and run `docker compose up --build`; it creates the new PostgreSQL volume while reusing the ledger and deployment volumes. Old SQLite files/volumes are left untouched and are not imported or automatically removed. Do **not** use `down --volumes` for this migration: that also destroys the ledger. The rebuildable tables contain chain observations, deployment identity, and a checkpoint; any separately added application-owned data needs an explicit export/import plan before discarding its source.

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

Playwright rejects a wallet signature, blocks a changed network, activates through real wallet signing, reopens the tab and reconnects while confirmation is pending, and exercises without the writer. It checks finalized agreement state, gross delivery, issuer fees, full USDC payout, reserve depletion, and writer ownership of the delivered account. Separate interface scenarios verify explicit connection, balance removal on disconnect, wallet loading/empty/error states, and ownership-aware presentation of public agreements. Recovery checks restart PostgreSQL and the validator/application, repeat bootstrap, and rebuild the chain projection while retaining identical financial state. Test cleanup removes only that run's project and volumes. Logs, browser traces on failure, screenshots, and rendered configuration remain under `artifacts/tests/localnet.*`.

For the same browser and recovery checks directly on the host, install Agave **4.0.3**, PostgreSQL **17.11**, Node, the Rust tools above, and Playwright Chromium, then run:

```sh
./tools/test fast
./tools/test app
./tools/rustup/cargo build --locked -p volaryn-backend --features localnet
npx playwright install chromium
npm run test:localnet
```

The native runner allocates separate ports and an artifact directory, starts its own PostgreSQL cluster, validator, and backend, and shuts down only those processes. It also stops PostgreSQL while the application stays running, verifies index degradation while chain transport and direct agreement reads stay available, and restores the database before checking retained financial observations. It preserves evidence and ledger files under `artifacts/localnet/run-*`; PostgreSQL logs and owned cluster data remain under `artifacts/postgres/run-*`. It never uses the manual demo's data or an ambient `DATABASE_URL`. On systems using a packaged Chromium, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` may point to that executable. This optional test-runner setting is not application configuration. Fast contract and application checks remain independent of a validator.

## Application modules and interfaces

| Path                          | Responsibility                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `backend/src/application.rs`  | Chain/index availability, direct reads, and reconciliation orchestration.                        |
| `backend/src/indexer.rs`      | Discovery scheduling and bounded account-pair reconciliation.                                    |
| `backend/src/queries.rs`      | Validated pagination and agreement filters shared by HTTP and storage.                           |
| `backend/src/observations.rs` | Public deployment and chain DTOs with exact decimal-string quantities and generated API schemas. |
| `backend/src/domain.rs`       | Typed application failures and chain-time helpers, independent of HTTP and storage.              |
| `backend/src/adapters/`       | Bounded Solana reads and transactional PostgreSQL projection storage.                            |
| `backend/src/http.rs`         | Typed REST endpoints, byte-preserving RPC proxy, health routes, and static delivery.             |
| `backend/migrations/`         | Ordered immutable SQL migrations embedded in the executable.                                     |
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

The application stores exact amount strings in typed JSONB projections and the finalized-slot checkpoint in bounded `NUMERIC(20,0)`. SQLx embeds migrations and validates their checksums under PostgreSQL migration locking. Migration `0002` backfills per-agreement slots/timestamps from the original JSONB rows and adds generated filter columns and indexes. The worker upserts bounded batches without deleting existing records; rows and their high-water checkpoint commit atomically, and older slots cannot overwrite newer observations. List queries bind filters and use `after` address cursors with a default limit of 50 and maximum of 200; `X-Next-Cursor` identifies the next page. Detail reads query one primary key. Tests use the application role, retain the entire `u64` range, reject ledger mismatches and changed migration history, and exercise rollback and concurrent startup. Stop the previous application writer before applying `0002`: the earlier writer does not supply the new required columns. Preserve database backups and use a forward fix, or restore a separately verified compatible application/schema pair; reverting the binary alone is insufficient. An application rollback requires a compatible schema.

`npm run build:live` produces a separate signer-free frontend artifact and `npm run check:live` verifies exclusion of the disposable wallet. This is a build-isolation check, not an external-deployment command. External deployment configuration follows its own pipeline gate; never point the local fixture environment at real assets.

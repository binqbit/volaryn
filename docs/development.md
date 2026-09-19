# Contract Development

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

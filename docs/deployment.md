# Deployment and operation

Volaryn has two explicit deployments. `docker compose up --build` runs the complete localnet product with disposable assets. `compose.live.yaml` runs a tested application image and PostgreSQL against Solana mainnet; the host provides HTTPS. It starts neither a validator nor fixture initialization and contains no disposable signer. Mainnet requires the reviewed PreStocks identities and Circle's [native Solana USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses).

## Release artifacts

From a clean checkout, after `./tools/test full` passes:

```sh
./tools/release/build artifacts/release
```

The build uses pinned images, locked packages, the pinned SBF compiler, generated-interface checks, and local/live frontend isolation. It produces `app.tar`, `image-id`, `release.env`, the compiled program, IDL, OpenAPI document, reviewed asset registry, dependency lockfiles, deployment template, Compose definition, operator tools, and `SHA256SUMS`. `release.json` records the source revision and artifact fingerprints. The image embeds the same revision and program hash, exposed through `GET /api/release`.

CI builds the live image after complete application checks and retains the release bundle for `v*` tags. It does not deploy the program, publish an image to a registry, or enable real-asset transactions. Promote this tested bundle to the host without rebuilding it there. Checksums establish integrity within a bundle; obtain the bundle from the trusted release workflow.

```sh
# Run inside the copied release bundle.
sha256sum -c SHA256SUMS
docker load --input app.tar
```

`release.env` selects the loaded image by content ID, so a mutable tag cannot silently choose another application. The application rejects a mainnet manifest whose program hash differs from its embedded release fingerprint. Reproducibility here means pinned inputs and identifiable artifacts; independent bit-for-bit SBF reproduction is a separate verification step.

### Optional WalletConnect pairing

Installed Solana Wallet Standard wallets, including Phantom, connect through the shared provider chooser. On mainnet, an absent Phantom has an installation link. WalletConnect adds QR pairing with compatible Solana mainnet wallets when the frontend is built with `VITE_WALLETCONNECT_PROJECT_ID`. Obtain a project ID from the [Reown dashboard](https://dashboard.reown.com/) and configure the application's allowed origins according to the [relay allowlist documentation](https://docs.reown.com/walletkit/ios/cloud/relay).

```sh
VITE_WALLETCONNECT_PROJECT_ID=YOUR_PUBLIC_PROJECT_ID \
  ./tools/release/build artifacts/release
```

The release script passes this optional value to Docker's frontend build argument. For a frontend-only artifact, supply the same environment variable to `npm run build:live`. It is a public project identifier embedded in browser JavaScript, not a secret or a runtime Compose setting. Changing it requires a new frontend artifact. The operator configures the ID; users scan the pairing QR code without entering a project ID. With the variable absent, WalletConnect remains disabled and installed wallets still work. Localnet needs no project ID and exposes its two disposable test wallets instead of WalletConnect pairing.

The Sign SDK loads when WalletConnect is used, including restoration of an existing connection. Its browser relay connection does not require WebSocket forwarding through the application host. Adapter tests use controlled SDK responses; successful pairing with an external wallet must be validated separately for the configured origin.

## Program deployment and authority

Application startup never deploys or upgrades a program, initializes the protocol, or signs policy changes. The release operator controls hosting and recovery; the program authority separately controls deployment and upgrades, and the protocol authority controls admission policy. These responsibilities may belong to one operator, but their private keys never enter the application container or deployment directory.

Before an initial public release, set the intended program address in the Rust declaration, Anchor configuration, and generated client, then build and test the resulting release. The deployed address must match that compiled identity. Generate and retain its keypair outside the repository. The fixture program address does not establish ownership of a deployable mainnet address.

The authorized operator deploys the **bundled** `volaryn.so` using the [Solana program deployment procedure](https://solana.com/docs/programs/deploying), initializes `ProtocolConfig` with native USDC, and applies reviewed `AssetPolicy` records using the bundled IDL and client from the matching source revision. Inspect the signed instructions before submitting. Include authority custody, upgrade policy, and the real-asset reviews required by the architecture in the release decision. An immutable program uses `upgradeAuthority: null`; it must be initialized before upgrade authority is removed.

A program upgrade changes the executable fingerprint. Plan a matching application release and manifest; an older application deliberately rejects the changed executable. Application rollback cannot reverse a program upgrade or a chain transaction.

## Minimal host configuration

The host needs Docker Compose and HTTPS termination. Preparation uses Python's standard library; Python is not an application runtime dependency. Store a credential-bearing RPC URL in a private file, then prepare deployment files inside the release directory:

```sh
python3 tools/release/configure.py \
  --release . \
  --rpc-url-file /secure/solana-rpc-url \
  --authority PUBLIC_PROTOCOL_AUTHORITY \
  --upgrade-authority PUBLIC_UPGRADE_AUTHORITY
```

Use `--upgrade-authority none` only for an immutable deployed program. The command creates `deployment/` once, generates distinct PostgreSQL administrator and application passwords, and copies the reviewed public template. It refuses to replace existing credentials. Parent directories have mode `0700`; secret files are readable by the container users through their explicit mounts. [Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/) are host file mounts, not an encrypted secret store.

Review `deployment/deployment.json` and retain only the admitted assets. Schema 3 contains the network genesis, program address, exact code fingerprint and length, protocol and upgrade authorities, USDC, and asset identities. A `localnet` participant block is accepted only by the local build and is absent from mainnet manifests. Unknown properties, mismatched networks, test mints, and unreviewed asset identities are rejected.

The only Compose variable is `VOLARYN_IMAGE`, supplied by the release file. RPC and database connection values remain in mounted secret files and are never sent to the browser. The administrator password is mounted only into PostgreSQL; the application role has no superuser, role-creation, or database-creation privileges. The database publishes no host port. Existing volumes retain their credentials; changing an initialization file does not rotate an existing database password.

## Verify and start

After explicit program and policy deployment, run a read-only check:

```sh
docker compose --env-file deployment/release.env -f compose.live.yaml \
  run --rm --no-deps app \
  --manifest /deployment/deployment.json \
  --rpc-url-file /run/secrets/rpc_url \
  --check-deployment
```

This verifies the released executable, loader linkage, upgrade authority, protocol authority, USDC mint and token program. It reports each asset's admission policy separately. Disabled or expired policy is a valid operational state and appears as `newCommitments: false`; it does not invalidate active rights. New mainnet creation and activation recheck reviewed mint behavior and policy bounds before signing and relay. Exercise, cancellation and reclamation do not depend on issuer market data or admission availability.

```sh
docker compose --env-file deployment/release.env -f compose.live.yaml \
  up -d --wait --wait-timeout 180
```

The application binds host loopback port 8080. Configure the host's HTTPS reverse proxy to forward the chosen domain to `http://127.0.0.1:8080`, preserve the path, limit request bodies to 2 MiB, and disable caching for HTML, `/api/*`, and `/rpc`. Hashed frontend assets may use their supplied immutable cache headers. Set ingress connection, request-rate, and upload-time limits for the expected workload. The application bounds body size and total upload duration, and limits concurrent handlers per route; these are not per-client abuse quotas. No WebSocket proxy is required. Wallet signing and cross-tab Web Locks require a secure browser origin.

```sh
python3 tools/release/smoke.py https://YOUR_DOMAIN \
  --release . --manifest deployment/deployment.json
```

The smoke check compares the hosted revision, program fingerprint, complete public manifest and asset list with the selected bundle, then checks health and navigation. It makes only GET requests. It does not prove wallet permission, real-asset trading eligibility, or successful mainnet settlement.

## Updates and rollback

Retain the previous release bundle, public manifest and database backup. Run the full checks and read-only deployment verification for a candidate release before changing the serving image. The bundled operator configuration is stable across releases; keep the existing deployment secrets and volume.

A release supports one contract format and requires its matching program, generated client, API, manifest and database schema. Historical conversions are not included. Development replaces incompatible disposable state through [local development reset](development.md#local-development-reset); this procedure must not be applied to live rights or retained application data. Such data requires a separately designed preservation plan before an incompatible release.

For a compatible application update, copy the new `release.env` to `deployment/release.env`, update the public manifest only when its reviewed identity changes, and run the same `up -d --wait` command. SQLx validates applied checksums and serializes migrations before readiness. A checksum conflict or incompatible network/database identity fails explicitly; startup does not reset state.

Rollback uses the retained previous image and matching manifest only if they support the deployed program and the applied database schema. Rehearse that exact candidate in an isolated restored database before using it. Do not run down-migrations automatically. If a program upgrade or schema change is incompatible, use an explicitly reviewed forward fix. Restarting the same release is tested independently of a cross-version rollback and must not be presented as proof of every older version's compatibility.

The local backend and release tooling tests verify configuration rejection, fresh schema initialization, repeated startup and migration-history conflicts. The full native harness also checks database outage recovery, projection rebuild, application and ledger restarts, restoration into a new database, and settlement through an independent client while the application is stopped.

## Backup and restore

Both agreement projections and operation receipts reside in PostgreSQL. Only projections are rebuildable from chain state; preserve receipts through real backups. Back up before an update and on an operator-owned schedule, copy backups off the host, restrict access, and rehearse restoration. Never treat a backup stored only in the database volume as disaster recovery.

```sh
# Preserve application tables and migration metadata in a custom-format archive.
mkdir -m 700 -p backups
(umask 077; docker compose --env-file deployment/release.env -f compose.live.yaml \
  exec -T database pg_dump -U volaryn -d volaryn --format=custom > backups/volaryn.dump)
```

Restore into a **fresh** PostgreSQL 17.11 service with the application role and an empty `volaryn` database. An isolated Compose project can provide that service without starting its application:

```sh
docker compose -p volaryn-restore --env-file deployment/release.env -f compose.live.yaml \
  up -d --wait database
docker compose -p volaryn-restore --env-file deployment/release.env -f compose.live.yaml \
  exec -T database pg_restore -U volaryn -d volaryn \
  --exit-on-error --single-transaction --no-owner --no-privileges < backups/volaryn.dump
```

The [PostgreSQL restore procedure](https://www.postgresql.org/docs/17/app-pgrestore.html) fails on conflicting objects; these commands deliberately do not drop existing tables. Start the selected compatible application against the restored database on an isolated host or port, run the smoke check, and compare operation history and agreement observations. Resynchronize projections from the unchanged ledger. A database restore never rewinds balances or transactions on Solana. Use a tested migration for PostgreSQL major upgrades.

## Diagnosis and recovery boundaries

`/health/live` reports the process, `/health/ready` verifies chain identity, and `/health/index` reports projection/database availability. Monitor all three; a healthy read path does not mean history or discovery is available. Each HTTP response carries `X-Request-Id`, matching structured logs with method, path, status and duration. Logs also identify reconciliation and dependency failures; `/api/release` identifies the serving code. Startup errors name their stage; RPC diagnostics report failure classes, HTTP status or RPC codes without connection URLs or upstream error bodies. Logs use stderr so deployment-check JSON on stdout remains machine-readable. Do not expose connection secrets in proxy logs or support bundles.

A wrong genesis, executable hash, upgrade authority, protocol authority, or USDC produces an identity failure. Check the selected bundle and manifest before attempting an update. An unavailable RPC is a dependency failure; changing manifests cannot fix it. Database failure pauses tracked submissions before broadcast, while verified read-only chain transport remains usable. Recovery resumes observation of saved signatures and never signs or resubmits a fresh transaction automatically.

The protocol authority may disable new commitments through asset policy while preserving valid exercise. With the application unavailable, an authorized holder can use the published IDL/client with another RPC to submit the same exercise instruction. The isolated localnet test demonstrates this boundary with actual transfers and no backend process.

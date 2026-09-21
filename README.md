# Volaryn

**Keep the upside. Define the downside before you need the exit.**

Volaryn is a Solana application for holders of PreStocks tokenized private-market positions. A holder keeps their asset and pays a premium for a time-limited, fully funded right to exchange an agreed quantity for a fixed USDC payout. A capital provider, called the writer, reserves that payout in advance and earns the premium for accepting the obligation.

Selling a position removes its future upside. Waiting to sell later leaves the exit dependent on future market conditions. Volaryn gives the holder another choice: keep the position while purchasing explicit exit terms for a defined period.

## How it works

1. Connect a wallet and select an eligible PreStocks position.
2. Review a writer's funded offer: asset quantity, USDC payout, premium, and expiry.
3. Pay the premium to activate protection. The underlying stays in the holder's wallet.
4. Before expiry, exercise to deliver the agreed quantity and receive the reserved USDC atomically, without another writer signature.
5. If protection expires unused, the writer can reclaim the reserve and keeps the premium.

PreStocks provides the underlying assets and their market context. Solana holds the agreement and reserve, and enforces settlement. The payout does not depend on a price oracle. If a supported mint charges an issuer transfer fee, it reduces the writer's net token receipt without reducing the agreed USDC payout.

The product targets the Stocklana main track and PreStocks sponsor track. Its focus is existing PreStocks positions, with exact token identities, valuation context, and lifecycle-aware eligibility. See the [official Stocklana brief](https://hackathons.solana.com/hackathons/stocklana).

## Architecture

The architecture combines a Rust backend, a React and TypeScript frontend, and a Rust Solana program. A single application container serves the frontend and API; PostgreSQL stores query projections and observations in a separate persistent service. The deployment model uses Docker Compose to start the local application, PostgreSQL, Solana validator, and automatic initialization together, without required environment variables.

Read [the product brief](docs/product.md) for the holder's problem, concrete outcomes, related products, and product boundaries. Read [the architecture](docs/architecture.md) for component boundaries, settlement rules, integrations, dependencies, and the deployment model.

The [technology stack](docs/tech-stack.md) explains the selected frameworks, alternatives, migrations, and toolchain boundaries. The [implementation pipeline](docs/pipeline.md) defines the development stages, working outcomes, dependencies, and acceptance checks.

## Product boundaries

Protection requires delivery of the specified asset before expiry. It does not insure against issuer restrictions, unavailable transfers, wallet compromise, or network failure. The payout is denominated in USDC, and the premium and network costs remain separate expenses. Local test assets are explicitly distinguished from genuine PreStocks holdings.

## Run locally

```sh
docker compose up --build
```

Open `http://localhost:8080`. Connect **Local test wallet** for the holder journey or **Local test writer** to fund and manage offers. Disconnect before switching roles. Every financial action opens a terms review before wallet signing. The local environment uses disposable Token-2022 assets with issuer fees and real on-chain settlement. No environment file or external account is required. Restarting preserves the ledger, database, and balances. Native development can use `npm run dev:localnet`; its pinned prerequisites and build commands are in the development guide.

- **Protection** matches funded offers by exact quantity, minimum payout, maximum premium, and holder eligibility; **My protection** shows the connected holder's active agreements.
- **Writer** creates fully funded offers, lists that wallet's commitments, cancels unaccepted offers, and returns reserves after unused protection expires.
- **Your wallet** lists each supported token account, including assets received by the writer. Exercise delivers from one selected account; separate balances are not combined.

Run `./tools/test app` for native backend/frontend checks, or `./tools/test full` for the isolated Compose browser and recovery suite. See the [development guide](docs/development.md#run-the-local-application) for setup, reset, native localnet testing, and generated interfaces.

## Contract development

Run the contract checks locally with the [pinned development tools](docs/development.md#run-the-checks):

```sh
./tools/test fast
```

Or use Docker to supply the tools and run the CI checks, including formatting:

```sh
./tools/test docker
```

Both commands build the Rust/Anchor program, verify its generated interface, and execute the same isolated settlement scenarios in LiteSVM against pinned token programs. The local command needs no container, validator process, wallet, RPC endpoint, or standalone formatters. See [the development guide](docs/development.md) for tool requirements, formatting, modular test structure, fixtures, and interface generation.

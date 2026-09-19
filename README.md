# Volaryn

**Keep the upside. Define the downside before you need the exit.**

Volaryn is a proposed Solana application for holders of PreStocks tokenized private-market positions. A holder keeps their asset and pays a premium for a time-limited, fully funded right to exchange an agreed quantity for a fixed USDC payout. A capital provider, called the writer, reserves that payout in advance and earns the premium for accepting the obligation.

Selling a position removes its future upside. Waiting to sell later leaves the exit dependent on future market conditions. Volaryn gives the holder another choice: keep the position while purchasing explicit exit terms for a defined period.

## How it works

1. Connect a wallet and select an eligible PreStocks position.
2. Review a writer's funded offer: asset quantity, USDC payout, premium, and expiry.
3. Pay the premium to activate protection. The underlying stays in the holder's wallet.
4. Before expiry, exercise to deliver the agreed quantity and receive the reserved USDC atomically, without another writer signature.
5. If protection expires unused, the writer can reclaim the reserve and keeps the premium.

PreStocks provides the underlying assets and their market context. Solana holds the agreement and reserve, and enforces settlement. The payout does not depend on a price oracle. Issuer transfer fees affect what the writer receives; they do not reduce the agreed USDC payout.

The product targets the Stocklana main track and PreStocks sponsor track. Its focus is existing PreStocks positions, with exact token identities, valuation context, and lifecycle-aware eligibility. See the [official Stocklana brief](https://hackathons.solana.com/hackathons/stocklana).

## Architecture and repository status

The target stack is a Rust backend, a React and TypeScript frontend, and a Rust Solana program. A single application container serves the frontend and API; SQLite provides local storage without a database service. The local demonstration also includes a Solana validator and automatic initialization through Docker Compose.

**This repository contains the product overview and architecture specification only. Application code, contracts, and Docker configuration are not implemented yet.** The intended local startup is `docker compose up --build`, without required environment variables; it is not an available command in this repository yet.

Read [the architecture](docs/architecture.md) for component boundaries, settlement rules, integrations, dependencies, and the deployment model.

## Product boundaries

Protection requires delivery of the specified asset before expiry. It does not insure against issuer restrictions, unavailable transfers, wallet compromise, or network failure. The payout is denominated in USDC, and the premium and network costs remain separate expenses. Local test assets are explicitly distinguished from genuine PreStocks holdings.

Volaryn is a hackathon product concept, not an audited financial service or a claim of regulatory approval. Demand from holders and independent writers remains to be validated.

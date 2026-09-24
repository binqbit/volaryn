# Try the protection flow

This walkthrough uses local test USDC and disposable PreStocks replicas. It demonstrates an actual Solana agreement and atomic settlement, with no real funds, external wallet, API key, or environment file.

## Start the application

```sh
docker compose up --build
```

Open `http://localhost:8080` after initialization completes. The first build downloads and compiles the pinned tools; a fresh ledger also needs several minutes to initialize and finalize its transactions. Follow progress with `docker compose logs -f bootstrap`. The one-shot bootstrap service exits successfully when it finishes; the application, validator, and database keep running.

A fresh ledger gives both test wallets 10,000 test USDC and 100 unscaled units of each replica before funding two offers. **Test Wallet 2** has already reserved 20 USDC for OPENAI and 20 USDC for SPACEX. **Test Wallet 1** can accept them. These are different participants because a writer cannot activate their own offer.

Restarts preserve balances and agreements. An offer's deadlines continue to pass; restarting does not create a replacement or undo an exercise. If a seeded offer was used or its acceptance deadline passed, create another offer as described below. There is no need to delete the database or ledger.

## Propose protection as a holder

1. Connect **Test Wallet 1**, open **Create offer**, and keep **Request protection** selected. Choose a replica, a fixed quantity, a 100 USDC payout and 10 USDC premium, and valid future dates. The amounts are editable examples.
2. Review and sign. The request escrows **10 USDC**; the underlying balance stays unchanged. Its **Sell request** badge and awaiting-provider state distinguish it from active protection. Copy the agreement link.
3. Disconnect, connect **Test Wallet 2**, and find the request under **Explore offers → Sell requests** or open its link. **Fund protection** requires the full **100 USDC** available before the **10 USDC** premium is released. Review and sign once.
4. After finalization, the reserve contains **100 USDC**, Test Wallet 2 has received the premium, and Test Wallet 1 owns the exercise right. Reconnect Test Wallet 1 to exercise before expiry; it receives the full payout for the fixed gross delivery without Test Wallet 2 signing again.

A holder may instead cancel an unaccepted request to recover its premium. Merely waiting until acceptance ends does not submit the refund. The creator cannot accept their own request.

## Accept a funded buy offer

1. **Inspect the writer's commitment.** Open **Connect wallet**, choose **Test Wallet 2**, open **My portfolio → My offers**, and open the funded OPENAI offer. It reserves **20 USDC**, charges a **0.5 USDC** premium, and requires delivery of **1 unscaled OPENAI unit**: exactly **1,000,000,000 base units**. Save its page address. A fresh seeded offer accepts activation for one hour and permits exercise for two hours after initialization; use the exact dates on the page.

2. **Switch to the holder.** Disconnect Test Wallet 2, connect **Test Wallet 1**, and open the saved agreement or select OPENAI in **Explore offers**. Review the asset identity, payout, premium, delivery quantity, deadlines, and issuer restrictions. **View wallet** shows the holder's available balances.

3. **Activate protection.** Choose **Activate protection**, review the terms, then **Confirm and sign**. The local test wallet signs directly from this review. Wait for **Transaction finalized** before checking the resulting balances: the holder paid **0.5 USDC**, the writer received it, the holder's OPENAI is unchanged, and **20 USDC** remains reserved. The agreement appears in **My portfolio → My protection**. Activation buys a right; it does not sell the underlying.

4. **Exercise without reconnecting the writer.** Keep Test Wallet 1 connected. Choose **Exercise protection**, review, and **Confirm and sign** before expiry. After finalization, the holder receives the full **20 USDC** and delivers the fixed quantity. The agreement shows settlement complete and cannot be exercised again. No writer signature or market-price condition is needed.

5. **Inspect both outcomes.** The holder's net USDC change across activation and exercise is **+19.5 USDC**, excluding separate SOL fees and account rent. Disconnect and reconnect **Test Wallet 2**: its completed offer shows the delivered settlement account, which the writer controls. **My portfolio → Activity** records the signed operations for the connected wallet; a counterparty's operation is reflected in the agreement, not presented as your own signed action.

The local fixture charges a **0.75% issuer transfer fee**. For that fixed gross delivery, the writer receives **0.9925 unscaled units** (992,500,000 base units); 0.0075 is withheld by the token program. This fee reduces the writer's token receipt, never the 20 USDC payout. A display multiplier can change a token's displayed equivalent, but not the agreement's fixed base-unit obligation. The fixture's fee and scaling are demonstrations, not claims about current mainnet terms.

## Create another offer or leave protection unused

Connect **Test Wallet 2** and open **Create offer**. Select **Provide protection**, choose a token, set the quantity, payout, premium and future UTC deadlines, and leave the optional counterparty restriction empty or set it to Test Wallet 1. Review and **Confirm and sign** to reserve the payout. Its **Buy offer** badge identifies the capital-provider origin. Once finalized, copy its page address, disconnect and use Test Wallet 1 to activate it.

An unaccepted buy offer can be cancelled by its writer; an unaccepted sell request can be cancelled by its holder to recover the premium. An activated offer cannot: leave it unused until its protection expiry, then use the writer's **Reclaim expired reserve** action. The writer recovers the reserved payout and keeps the premium; the holder keeps their remaining tokens and receives no payout. Neither expiry nor a falling price automatically submits a transaction.

## Compare the official PreStocks context

Open **PreStocks catalogue / Official assets** to inspect the real issuer identities, source values, verified mainnet mint behavior, and lifecycle limits. These observations are separate from the local balances and offers. Stale or unavailable sources are labelled; the catalogue cannot sign a mainnet transaction. The [asset integration guide](asset-integration.md) explains the evidence boundary.

For reproducible verification, `./tools/test full` runs the isolated Compose journey and recovery checks. The [development guide](development.md#application-checks) also provides the native localnet runner, which demonstrates settlement for both origins with the application stopped. Real-asset hosting follows the separate [deployment guide](deployment.md).

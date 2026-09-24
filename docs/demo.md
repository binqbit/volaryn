# Try the protection flow

This walkthrough uses local test USDC and disposable PreStocks replicas. It demonstrates an actual Solana agreement and atomic settlement, with no real funds, external wallet, API key, or environment file.

## Start the application

```sh
docker compose up --build
```

Open `http://localhost:8080` after initialization completes. The first build downloads and compiles the pinned tools; a fresh ledger also needs several minutes to initialize and finalize its transactions. Follow progress with `docker compose logs -f bootstrap`. The one-shot bootstrap service exits successfully when it finishes; the application, validator, and database keep running.

A fresh ledger has **zero offers and agreements**. **Explore offers** and both test wallets' portfolios are empty. Each wallet has **10,000 available test USDC and 100 unscaled units of each replica**. Initialization prepares the protocol, policies, assets and wallets; you create the first offer. Use different wallets to propose and accept because a creator cannot accept their own offer.

Restarts preserve balances and user-created agreements. An offer's deadlines continue to pass; restarting does not create a replacement, clear agreements or undo an exercise. If an offer was used or its acceptance deadline passed, create another offer as described below. There is no need to delete the database or ledger.

## Propose protection as a holder

1. Connect **Test Wallet 1**, open **Create offer**, and keep **Request protection** selected. Choose **OPENAI**, **1 unscaled unit**, a **100 USDC payout** and **10 USDC premium**, and valid future dates. These are editable example terms; 1 OPENAI unit is exactly 1,000,000,000 base units.
2. Review and sign. The request escrows **10 USDC**; the underlying balance stays unchanged. Its **Sell request** badge and awaiting-provider state distinguish it from active protection. Copy the agreement link.
3. Disconnect, connect **Test Wallet 2**, and find the request under **Explore offers → Sell requests** or open its link. **Fund protection** requires the full **100 USDC** available before the **10 USDC** premium is released. Review and sign once.
4. After finalization, the reserve contains **100 USDC**, Test Wallet 2 has received the premium, and Test Wallet 1 owns the exercise right. Reconnect Test Wallet 1 to exercise before expiry; it receives the full payout for the fixed gross delivery without Test Wallet 2 signing again. Across this request and exercise, Test Wallet 1 gains **90 USDC net** and delivers **1 OPENAI unit**. Test Wallet 2 spends **90 USDC net** and controls **0.9925 OPENAI units** in the settlement account after the fixture's issuer fee. The reserve is depleted. SOL fees and account rent are separate.

A holder may instead cancel an unaccepted request to recover its premium. Merely waiting until acceptance ends does not submit the refund. The creator cannot accept their own request.

## Create and accept a funded buy offer

1. **Create the writer's commitment.** Connect **Test Wallet 2**, open **Create offer**, and select **Provide protection**. Choose **OPENAI**, **1 unscaled unit**, a **100 USDC payout** and **10 USDC premium**. Keep the suggested future dates or edit them, then review and **Confirm and sign**. Wait for finalization: **100 USDC** is reserved and the new agreement appears in **My portfolio → My offers** with a **Buy offer** badge. Save its page address. Suggested local dates allow acceptance for one hour and exercise for two hours from the observed validator time when the form initializes its dates; use the exact deadlines on the review and agreement page.

2. **Switch to the holder.** Disconnect Test Wallet 2, connect **Test Wallet 1**, and open the saved agreement or select OPENAI in **Explore offers**. Review the asset identity, payout, premium, delivery quantity, deadlines, and issuer restrictions. **View wallet** shows the holder's available balances.

3. **Activate protection.** Choose **Activate protection**, review the terms, then **Confirm and sign**. The local test wallet signs directly from this review. Wait for **Transaction finalized** before checking the resulting balances: the holder paid **10 USDC**, the writer received it, the holder's OPENAI is unchanged, and **100 USDC** remains reserved. The agreement appears in **My portfolio → My protection**. Activation buys a right; it does not sell the underlying.

4. **Exercise without reconnecting the writer.** Keep Test Wallet 1 connected. Choose **Exercise protection**, review, and **Confirm and sign** before expiry. After finalization, the holder receives the full **100 USDC**, delivers the fixed quantity, and the reserve is depleted. The agreement shows settlement complete and cannot be exercised again. No writer signature or market-price condition is needed.

5. **Inspect both outcomes.** The holder's net USDC change across activation and exercise is **+90 USDC**; the writer's change across creation, activation and exercise is **−90 USDC**, excluding separate SOL fees and account rent. Disconnect and reconnect **Test Wallet 2**: its completed offer shows the delivered settlement account, which the writer controls. **My portfolio → Activity** records the signed operations for the connected wallet; a counterparty's operation is reflected in the agreement, not presented as your own signed action.

The local fixture charges a **0.75% issuer transfer fee**. For that fixed gross delivery, the writer receives **0.9925 unscaled units** (992,500,000 base units); 0.0075 is withheld by the token program. This fee reduces the writer's token receipt, never the 100 USDC payout. A display multiplier can change a token's displayed equivalent, but not the agreement's fixed base-unit obligation. The fixture's fee and scaling are demonstrations, not claims about current mainnet terms. Each walkthrough's balance changes are relative to its own starting balances; running both applies both sets of changes.

## Create another offer or leave protection unused

Connect **Test Wallet 2** and open **Create offer**. Select **Provide protection**, choose a token, set the quantity, payout, premium and future UTC deadlines, and leave the optional counterparty restriction empty or set it to Test Wallet 1. Review and **Confirm and sign** to reserve the payout. Its **Buy offer** badge identifies the capital-provider origin. Once finalized, copy its page address, disconnect and use Test Wallet 1 to activate it.

An unaccepted buy offer can be cancelled by its writer; an unaccepted sell request can be cancelled by its holder to recover the premium. An activated offer cannot: leave it unused until its protection expiry, then use the writer's **Reclaim expired reserve** action. The writer recovers the reserved payout and keeps the premium; the holder keeps their remaining tokens and receives no payout. Neither expiry nor a falling price automatically submits a transaction.

## Compare the official PreStocks context

Open **PreStocks catalogue / Official assets** to inspect the real issuer identities, source values, verified mainnet mint behavior, and lifecycle limits. These observations are separate from the local balances and offers. Stale or unavailable sources are labelled; the catalogue cannot sign a mainnet transaction. The [asset integration guide](asset-integration.md) explains the evidence boundary.

For reproducible verification, `./tools/test full` runs the isolated Compose journey and recovery checks. Automated native and Compose runners first verify the empty startup, then explicitly create their own two funded test offers through a test-only helper. These fixtures are not part of normal startup. The [development guide](development.md#application-checks) also provides the native localnet runner, which demonstrates settlement for both origins with the application stopped. Real-asset hosting follows the separate [deployment guide](deployment.md).

# Volaryn: The Holder's Problem and the Funded Exit Right

This document explains the product, its user problem, and how it addresses that problem. [The architecture](architecture.md) defines the system and settlement rules. Numerical examples illustrate the agreement's economics; they are not customer testimonials or executable quotes.

Volaryn lets an eligible PreStocks holder keep a tokenized private-market position while purchasing a time-limited right to deliver an agreed quantity for a fixed USDC payout. Another participant reserves the entire payout and receives a premium for accepting that obligation. After activation, the holder can exercise without asking that participant to approve the trade again.

The product starts with an existing wallet position and a practical decision: how much of this exposure does the holder want to keep, and what exit terms would make keeping it acceptable?

## 1. The decision a holder faces

Consider someone who owns OpenAI exposure through PreStocks. They still believe in the company's long-term prospects, but the position has become large relative to the loss they are willing to absorb over the next month. Their conviction about the company and their tolerance for a near-term loss are different decisions.

Selling everything resolves the exposure but also gives up participation in a subsequent increase. Selling part reduces both the potential loss and the upside on that part. Holding everything preserves participation but leaves the holder exposed to whatever exit conditions exist when they eventually need to sell.

The holder's request is specific:

> I want to keep this position, but I am willing to pay today for the right to exchange an agreed amount for a known USDC payout before a particular date.

This is different from asking for a better price prediction. Even a correct warning about deteriorating conditions does not create a buyer at a pre-agreed amount. A dashboard can explain exposure; an alert can prompt action; neither reserves the money needed to honor a future exit.

The problem has three parts. The holder must identify exactly what they own, choose a tolerable trade-off between cost and exit terms, and know whether the chosen exit will require someone else's discretionary cooperation later. Volaryn's workflow connects those three decisions.

## 2. Why the underlying instrument matters

PreStocks provides economic exposure to private companies. Its disclosures distinguish that exposure from shareholder rights and warn that secondary-market liquidity is not guaranteed. The product problem therefore concerns a specific token and its transferability, rather than an abstract company valuation. [PreStocks FAQ and disclosures](https://prestocks.com/faq).

Three distinctions shape the holder's decision:

- **A displayed value is context for a decision.** PreStocks presents token price, implied valuation, mark price, and mark valuation separately. Those readings help a holder understand the position, but are not themselves a commitment to purchase it. Volaryn presents the agreed USDC payout separately from all of them. [PreStocks products](https://prestocks.com/products).
- **An executable exit depends on conditions at execution.** A token can be tradable without every future order being executable at the holder's desired size and price. Jupiter documents PreStocks trading and explains liquidity, slippage, partial-fill, and stop-loss limitations. These are execution constraints, not evidence that PreStocks is categorically illiquid. [Jupiter tokenized stocks](https://docs.jup.ag/user-docs/trade/spot/tokenized-stocks), [trading risks](https://docs.jup.ag/user-docs/trade/spot/risks-and-limitations).
- **The instrument can have a lifecycle deadline.** Issuer conversion notices can impose a deadline on the exact token, as illustrated by PreStocks' SPACEX and XAI notices. A contract demanding delivery of an obsolete asset after its deadline would not solve the holder's problem. Volaryn constrains eligible assets and protection dates using the applicable issuer notice. [SPACEX notice](https://prestocks.com/spacex), [XAI notice](https://prestocks.com/xai).

A hedge referencing another issuer's token or a company-level index can produce a different result from an agreement accepting the exact token in the holder's wallet. This is a design inference: price correlation does not establish identical delivery rights, issuer rules, or exit conditions.

## 3. What the existing choices accomplish

The alternatives are useful tools with different outcomes. The choice depends on what the holder is trying to preserve.

| Holder's action           | What it accomplishes                                                     | Trade-off relative to the funded exit right                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sell the entire position  | Converts exposure into the sale proceeds available now.                  | The holder gives up the position's subsequent upside. This can be the right choice when they no longer want exposure.                                       |
| Sell a portion            | Reduces the size of both gains and losses from subsequent moves.         | The sold portion no longer participates; the retained portion has no contractual exit floor.                                                                |
| Use a stop or limit order | Automates an attempt to trade under specified conditions.                | Execution remains subject to order rules and market conditions. It does not reserve a dedicated writer's full payout for a holder-controlled exercise.      |
| Buy a suitable put        | Adds a paid, time-limited downside right while retaining the underlying. | This is the established financial structure Volaryn applies; suitability depends on the exact instrument, terms, and available market.                      |
| Borrow against the asset  | Provides USDC while retaining an economic interest in collateral.        | The asset is locked, and recovering it requires repayment under the loan terms. Some fixed-term loans also provide a downside choice through non-repayment. |

The stop/limit distinction follows [Jupiter's execution limitations](https://docs.jup.ag/user-docs/trade/spot/risks-and-limitations). A protective put is an established strategy described by [Cboe's Options Institute on Fidelity](https://www.fidelity.com/learning-center/investment-products/options/options-strategy-guide/protective-put). The borrowing alternative is particularly relevant: [Jupiter Offerbook](https://docs.jup.ag/user-docs/earn/offerbook) explicitly describes a downside use case in which a borrower receives USDC and can surrender collateral rather than repay at maturity.

Volaryn is appropriate only if the holder values retaining the asset in their wallet, keeping the choice of when to deliver it, and paying a disclosed premium for that choice. It is not automatically cheaper or economically better than selling, borrowing, or using an available option elsewhere.

## 4. The agreement Volaryn creates

The agreement answers four questions before the holder pays: **which asset, how much must be delivered, how much USDC is received, and until when?** The premium is a separate cost.

1. **Identify the position.** Connect the wallet, recognize a supported official PreStocks mint, and show the spendable position with its market context and lifecycle restrictions.
2. **Review a funded offer.** A writer specifies the delivery quantity, USDC payout, premium, and expiry, and deposits the entire payout. A suggested price or unfunded expression of interest is not shown as reserved protection.
3. **Activate the right.** The holder accepts before the offer's deadline and pays the premium. The underlying stays in the holder's wallet; the USDC remains reserved for this agreement.
4. **Choose whether to exercise.** Before protection expires, the holder may deliver the entire agreed amount once; partial exercise is not supported. Asset delivery, payment of the full USDC payout, and consumption of the right occur atomically. The writer cannot decline because the acquisition has become unattractive.
5. **Resolve unused protection.** If the holder does not exercise before expiry, the right ends. The writer can reclaim the reserve and keeps the premium. The holder retains any underlying they still own.

Exercise is the holder's action. It does not happen automatically when a displayed price falls, and the application must make the deadline explicit. No price feed decides whether an otherwise valid exercise is allowed.

The contract fixes the gross quantity debited from the holder. If a supported PreStocks mint applies an issuer-level transfer fee, that fee reduces the writer's net token receipt without reducing the agreed USDC payout or requiring an extra holder top-up. Both parties see the estimated net receipt and any applicable fee exposure before signing. Raw quantity and display scaling are handled as specified in [the architecture](architecture.md#quantity-and-issuer-transfer-rules).

## 5. An illustrative outcome

Assume an agreed PreStocks position has an illustrative value of 10,000 USDC when the agreement is activated. A writer offers a payout of 8,000 USDC for that quantity, for a 300 USDC premium, exercisable before a stated expiry 30 days away. These are explanatory numbers, not market pricing or a claim that such an offer is available.

The writer reserves **8,000 USDC**. The holder pays **300 USDC** and keeps the underlying.

| Situation before expiry                                | Holder's choice                              | Result                                                                                                                                                    |
| ------------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The position's illustrative value rises to 14,000 USDC | Retain the asset and leave the right unused. | The holder retains that exposure; subtracting the premium gives 13,700 USDC of illustrative value before other costs. This is not realized sale proceeds. |
| The position's illustrative value falls to 4,000 USDC  | Exercise while delivery remains possible.    | The holder delivers the agreed quantity and receives exactly 8,000 USDC. After the premium, the net cash amount is 7,700 USDC before other costs.         |
| The position remains around 10,000 USDC                | Let protection expire.                       | The holder retains the position and has spent 300 USDC on a right they did not use.                                                                       |

The 8,000 USDC payout is a contractual amount, not a promise to preserve 80% of the holder's original investment after costs. Original cost basis, premium, network costs, and USDC's own risks remain relevant. At expiry the right ends; a subsequent fall is outside this agreement.

For the writer, unused expiry returns the 8,000 USDC reserve while they keep the 300 USDC premium. If exercised, they pay 8,000 USDC for the delivered tokens: a net acquisition cash cost of 7,700 USDC after premium, before other costs. Any applicable issuer transfer fee reduces the acquired quantity. The asset may now be worth substantially less; the premium compensates the writer for that risk and does not guarantee a profit.

## 6. Why a writer would commit capital

The second user is an investor prepared to acquire a specific PreStocks asset under acceptable terms. They may prefer a lower acquisition level to buying immediately, and may accept a premium in exchange for committing capital for a defined period.

That commitment has a real cost. While an offer is funded, its reserve is unavailable elsewhere unless the writer cancels before activation. Once activated, they cannot withdraw it before expiry or avoid a valid exercise. If exercised, they acquire the asset under the agreed terms even after unfavorable news. Any applicable issuer transfer fee affects their net receipt, and the asset may lose most or all of its value.

The writer's decision therefore includes the exact asset, net quantity they may receive, committed capital, duration, premium, and lifecycle risks. A headline percentage yield would omit much of that decision.

The product only has an executable market when a holder's willingness to pay meets a writer's required compensation and transaction costs. If it does not, Volaryn should show no matching funded offer. The platform does not manufacture a counterparty or assume that collateral arrives after protection is sold.

## 7. How the product choices change the experience

Volaryn applies a familiar option structure through a workflow that starts with the exact PreStocks position already in the holder's wallet and accounts for that issuer's token mechanics, valuation context, and lifecycle. These requirements shape both the user's decision and the terms the program enforces.

| Product choice                                    | What it changes for the user                                                                                                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start from a verified wallet holding              | The holder reviews protection for the asset they actually own, rather than inferring whether a similarly named market is an adequate hedge.                                                                                  |
| Present quantity, payout, cost, and date together | The decision can be understood without navigating option chains or interpreting volatility metrics. The underlying financial terms remain visible.                                                                           |
| Use PreStocks market and lifecycle context        | The holder can relate the cost and payout to the issuer's information, while known conversion deadlines constrain available terms. Unit-dependent valuation calculations remain unavailable until their inputs are verified. |
| Require an isolated, fully funded reserve         | A holder can inspect the actual backing of the offered payout before activation. The reserve is neither shared across promises nor invested for yield.                                                                       |
| Keep exercise tied to fixed delivery terms        | A changed reference price or unavailable market-data API cannot change the agreed payout. Valid settlement does not require a fresh writer decision.                                                                         |
| Account for issuer fees and token behavior        | Both sides understand gross delivery and estimated net receipt. Changes to display scaling do not silently change the underlying obligation.                                                                                 |

These choices describe the product's contribution as a complete workflow. Funding collateral or adding a PreStocks logo to a generic options screen would demonstrate only part of that workflow.

Solana is useful here because the existing asset, the reserved USDC, and the agreement can participate in one enforceable transaction. The holder does not first send the asset and then wait for payment. The writer receives control of the delivered balance without needing to reconnect. The precise mechanics and trust boundaries are defined in [the architecture](architecture.md#4-on-chain-agreement).

## 8. Related products and the comparison they establish

The following comparison describes mechanisms documented by the linked projects. It compares product approaches and protocol precedents, without making claims about market availability, liquidity, or audit status. It is selective and does not establish that no other product serves PreStocks holders.

| Product or precedent                                                                                                                                                                                       | Documented approach and overlap                                                                                                                                                              | What Volaryn must demonstrate beyond that overlap                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Anneal](https://annealfi.io/)                                                                                                                                                                             | Describes private OTC options on Solana, agent-assisted RFQs, and a permissioned writer market. Its documented XAUt0 protective-put example uses cash settlement in USDT and an expiry TWAP. | A workflow for an existing PreStocks holder to deliver the exact agreed token quantity for a fixed full USDC payout before expiry, with issuer and lifecycle rules. Volaryn does not require a settlement-price oracle or agent-negotiated pricing.                                                               |
| [Epicentral / Solana Option Standard](https://beta.epicentral.markets/)                                                                                                                                    | Describes American-style options infrastructure for Solana tokens, a non-custodial interface, fractional option tokens, and Option Pools.                                                    | The complete PreStocks holding-to-exercise workflow and its exact settlement rules. Reusing general options infrastructure requires verification of the admitted mint's Token-2022 behavior and Volaryn's reserve model.                                                                                          |
| [StockWorks Options](https://stockworks.fun/options)                                                                                                                                                       | Describes fully collateralized, peer-to-peer, physically settled American options on tokenized equities on Robinhood Chain, including secured puts.                                          | A usable protection workflow for actual PreStocks positions on Solana, including mint admission, issuer fees, delivery requirements, and lifecycle limits. Physical settlement and prefunding alone do not establish a distinction.                                                                               |
| [PsyOptions American source](https://github.com/mithraiclabs/psyoptions/blob/a7f85984995e01f77415baf7bca2ff7552f25322/programs/psy_american/src/lib.rs)                                                    | A historical Solana mechanism precedent for collateralized option and writer tokens and fixed-asset exercise without a settlement-price oracle.                                              | A holder-specific PreStocks agreement and complete application workflow, without requiring a separately tradable option token. The basic on-chain financial mechanism has precedent.                                                                                                                              |
| [PowerTrade / PowerDEX xStocks options](https://support.power.trade/trading/xstocks-tokenized-stock-options-or-trade-tesla-nvidia-and-more/xstocks-introduction-or-tokenized-stocks-daily-options-and-rfq) | Documents options on public-equity and index xStocks, multiple expiries, protective puts, and RFQ trading.                                                                                   | An agreement accepting the exact supported private-market PreStocks token, presented alongside the holder's position and its issuer-specific conditions. Tokenized-stock options already exist; the product case rests on the specific holder workflow.                                                           |
| [Jupiter Offerbook](https://docs.jup.ag/user-docs/earn/offerbook)                                                                                                                                          | Documents fixed-term, oracle-free USDC loans without price-based liquidation, including a downside use case through surrendering collateral at maturity.                                     | A different custody and cash-flow choice: the holder keeps the asset in their wallet and pays a premium for optional delivery later. Offerbook locks collateral and advances USDC now; recovering collateral requires principal plus interest. Asset eligibility depends on the lending market's admission rules. |
| [Plume's published design](https://github.com/PlumeTrade/Plume)                                                                                                                                            | Describes fully collateralized American tokenized-equity options on Robinhood Chain. Its put payoff is a price difference calculated from an oracle.                                         | Delivery of the agreed PreStocks quantity in exchange for the full fixed USDC payout. No exercise-price oracle is needed, but the holder must be able to deliver the token.                                                                                                                                       |

The existing options precedents make the financial structure understandable. They also set the standard for the demonstration: the case for Volaryn must come from how completely it handles the chosen holder's task, including the inconvenient token and issuer details.

The [architecture](architecture.md#settlement-engine-choice) defines the settlement program and the requirements for reusing existing infrastructure. Any implementation must preserve the same asset-compatibility and settlement rules.

## 9. Product success criteria and boundaries

Product success depends on holders finding the right useful, independent writers accepting the obligation, and both sides agreeing on executable terms. These criteria measure the service beyond the existence of a financial contract.

| Question                                            | Useful evidence                                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Do holders want this trade-off?                     | For a specific existing position, ask what quantity and period matter and the maximum premium they would actually pay.                         |
| Will independent writers fund it?                   | Present the same quantity, payout, expiry, fees, and asset risks; obtain a minimum acceptable premium backed by willingness to commit capital. |
| Do the two sides meet?                              | Compare executable terms for the same agreement, rather than comparing unrelated statements of interest.                                       |
| Does the interface communicate the right correctly? | Ask users to explain the payout, premium, delivery requirement, writer risk, and expiry without prompting.                                     |
| Does the implementation honor it?                   | Execute the full flow and adverse cases against the program, including writer absence and failed token transfers.                              |

The right remains conditional on the holder delivering the specified asset before expiry. Issuer freeze, pause, burn, or migration, insufficient holdings, wallet compromise, USDC restrictions, network unavailability, and missed expiry can prevent the intended outcome. Program correctness and any upgrade authority are additional trust boundaries. Volaryn does not claim insurance, a guaranteed investment return, regulatory approval, or protection against every form of loss.

The outcome is concrete: a holder who chooses to keep a PreStocks position can buy a separately funded exit right, understand its cost and conditions, and exercise it without another writer approval.

# Offers, agreements, and operation history

An agreement represents an on-chain right and its reserved funds. An operation is an attempt to create or change that agreement. The portfolio shows both without treating a signature, pending transaction, or database receipt as a funded offer.

## Agreement lifecycle

| State in the interface      | Meaning                                                                            | Available next action                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Available                   | The writer has reserved the entire payout; the acceptance deadline has not passed. | An eligible holder pays the premium to activate, or the writer cancels.                                                               |
| Acceptance ended            | The offer remains unaccepted; its acceptance window has closed.                    | The writer cancels to recover the reserve. Closing the window does not automatically move money.                                      |
| Active                      | The holder has paid the premium and owns the exercise right until expiry.          | The holder delivers the agreed gross PreStocks quantity and receives the fixed payout. The writer cannot withdraw the active reserve. |
| Expired · awaiting reclaim  | The exercise deadline has passed without exercise.                                 | The writer reclaims the reserve.                                                                                                      |
| Exercised                   | Delivery and payout settled atomically.                                            | The writer owns the delivered assets. Residual recovery remains available.                                                            |
| Cancelled                   | The unaccepted offer was cancelled and its reserve returned.                       | Residual recovery remains available.                                                                                                  |
| Expired · reserve reclaimed | The expired active agreement's reserve was returned to its writer.                 | Residual recovery remains available.                                                                                                  |

The deadline is exclusive: acceptance and exercise stop at the corresponding on-chain timestamp. The interface checks chain time; an unavailable clock does not authorize an action. Residual recovery does not reopen an agreement or erase its outcome. Version 1 has immutable terms, a fixed holder after activation, and no partial acceptance, partial exercise, transfer, or early writer withdrawal from an active agreement.

**Explore offers** lists finalized, funded, still-acceptable offers. After activation, an agreement leaves that market but remains in the holder's **My protection** and the writer's **My offers**, including after settlement. These are wallet filters over public chain records, not confidentiality controls; direct agreement URLs remain readable by anyone.

## Operation lifecycle

Each confirmed review starts a separate attempt. Merely editing a form or closing its terms review does not submit an operation.

| Status                              | Evidence and recovery                                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preparing transaction               | Rechecking the reviewed terms, balances, accounts, network and wallet.                                                                                               |
| Waiting for wallet approval         | The exact transaction is awaiting an explicit signature.                                                                                                             |
| Not submitted                       | Preparation failed or approval was cancelled. The recorded error explains why; a new attempt requires a fresh review.                                                |
| Signing interrupted · not submitted | The page closed before a signed transaction was journaled. No automatic submission or signature is attempted.                                                        |
| Awaiting confirmation               | A signed identifier is saved; submission or confirmation is in progress. This does not prove that the relay received it.                                             |
| Confirmed · awaiting finality       | The RPC reports confirmation, which is still provisional.                                                                                                            |
| Finalized                           | Finalized signature history reports success. Agreement discovery may catch up afterward.                                                                             |
| Failed on chain                     | Finalized signature history reports a transaction error. No partial settlement occurred.                                                                             |
| Expired · action not completed      | The signed lifetime has ended and finalized agreement state proves the requested effect did not occur.                                                               |
| Action verified                     | Finalized agreement state proves the requested effect, although the particular signature's history is unavailable. This is not a claim that the signature was found. |
| Outcome unknown · checking          | Submission feedback, signature history, or sufficient state proof is unavailable. Observation continues; no automatic replacement transaction is created.            |

The same tracking applies to creation, activation, exercise, cancellation, expiry reclaim, and residual recovery. A failed attempt does not change an agreement's lifecycle. Another wallet can win activation, an acceptance deadline can pass while signing, and balances or issuer restrictions can change after review; the program remains authoritative when a transaction executes.

## Persistence and recovery

- The browser stores public attempt details and one unresolved signed operation per genesis hash, program, and signing wallet. Web Locks serialize signing across tabs on the same origin. Closing a tab leaves the signed identifier available for observation; cancellation cannot undo a submitted transaction.
- Before forwarding a supported Volaryn transaction through `/rpc`, the server verifies its cryptographic signature and decodes the actor, operation, agreement, and creation terms from its signed instruction. It records the receipt in PostgreSQL, keyed uniquely by signature. Callers cannot write an activity row merely by claiming another wallet address.
- The supported submission contract is a base64 legacy transaction containing one Volaryn operation, with its actor as the sole signer and fee payer. The backend verifies that its blockhash is valid and records a server-observed lifetime bound. Private keys and reusable signed transaction bytes are never stored.
- A separate bounded worker observes outstanding receipts even when no browser is open. Finalized outcomes never regress to pending. Missing signature history alone is not failure: after the lifetime boundary, the worker reads the agreement at a sufficiently recent finalized root. Repeatable residual recovery cannot be proven from balances alone and can remain unresolved if its signature history is lost.
- If PostgreSQL cannot record a supported operation, the relay does not forward it. Read-only chain access and direct agreement lookups remain available. If the response is lost after persistence or forwarding, the browser retains its journal and reconciles instead of signing again.
- **Activity** is paginated by receipt ID, with unresolved receipts returned separately from the current history page. Connecting the same wallet in another browser recovers server-recorded operations. Unsigned, declined, and interrupted attempts remain local to their originating browser; they are not authenticated public transactions.

Wallet reconnection saves only the wallet name and public account preference, scoped to the deployment's genesis and program. After verifying network identity, the application asks that wallet to reconnect silently. The wallet decides whether prior authorization is still valid. An explicit **Disconnect** removes this preference; it does not delete operation history. Reconnection never signs or sends a transaction.

Pending creations and activations appear in their portfolio view before the agreement projection exists. Once the finalized agreement appears, its regular card replaces that temporary entry. Completed and unsuccessful attempts remain in **Activity**, with the operation, time, status, agreement link, and signature when available. Portfolio totals use finalized agreement observations only.

Agreement projections can be rebuilt from chain accounts. Operation receipts are application history: backing up PostgreSQL preserves them; rebuilding the projection cannot reconstruct every failed or never-broadcast attempt. Deleting browser storage removes local unsigned history and any signed identifier that never reached the server. No reset deletes or reverses an on-chain agreement.

The confirmation distinction follows Solana's [signature status API](https://solana.com/docs/rpc/http/getsignaturestatuses) and [transaction retry guidance](https://solana.com/developers/guides/advanced/retry).

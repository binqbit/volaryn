import type { useTransaction } from './useTransaction';
import { Link } from 'react-router';
import styles from '../App.module.css';

export function TransactionStatus({
  transaction,
}: {
  transaction: ReturnType<typeof useTransaction>;
}) {
  const unavailable =
    transaction.activity.status === 'error' ? (
      <div className={styles.error} role="alert">
        Activity is unavailable. New submissions are paused until your wallet’s operations can be
        checked.
        <button onClick={() => transaction.activity.refresh()}>Refresh activity</button>
      </div>
    ) : null;
  if (transaction.phase === 'idle') return unavailable;
  const text = {
    preparing: 'Preparing transaction…',
    'not-submitted': 'Transaction not submitted',
    'awaiting-signature': 'Waiting for wallet approval…',
    provisional: 'Confirmed on chain · waiting for finality',
    finalized: 'Transaction finalized',
    reconciled: 'Action verified from finalized agreement state',
    expired: 'Signature expired · action not completed',
    unresolved: 'Outcome unresolved · reconciling signature',
    pending: 'Signed transaction · confirmation pending',
    failed: 'Transaction failed on chain',
  };
  return (
    <>
      {unavailable}
      <div
        className={styles.transaction}
        role="status"
        aria-label="Transaction status"
        aria-live="polite"
      >
        {text[transaction.phase]}
        {transaction.pending && <code>{transaction.pending.signature}</code>}
        <Link to="/portfolio/activity">View activity →</Link>
      </div>
    </>
  );
}

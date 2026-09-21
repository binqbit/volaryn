import type { useTransaction } from './useTransaction';
import styles from '../App.module.css';

export function TransactionStatus({
  transaction,
  connected,
}: {
  transaction: ReturnType<typeof useTransaction>;
  connected: boolean;
}) {
  const text = {
    idle: connected
      ? 'Your wallet signs. The contract settles.'
      : 'Browsing only · no wallet connected',
    'awaiting-signature': 'Waiting for wallet approval…',
    provisional: 'Confirmed on chain · waiting for finality',
    finalized: 'Transaction finalized',
    reconciled: 'Action verified from finalized agreement state',
    expired: 'Signature expired · action not completed',
    unresolved: 'Outcome unresolved · reconciling signature',
    pending: 'Transaction submitted · confirmation pending',
    failed: 'Transaction was not completed',
  };
  return (
    <div
      className={styles.transaction}
      role="status"
      aria-label="Transaction status"
      aria-live="polite"
    >
      {text[transaction.phase]}
      {transaction.pending && <code>{transaction.pending.signature}</code>}
    </div>
  );
}

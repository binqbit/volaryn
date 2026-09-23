import { formatUnits, type TokenAccount } from '../lib/api/client';
import styles from './TokenAccounts.module.css';

/** Account addresses stay visible; only split balances need a per-account amount. */
export function TokenAccounts({ accounts, symbol }: { accounts: TokenAccount[]; symbol: string }) {
  if (!accounts.length) return null;
  const multiple = accounts.length > 1;
  return (
    <div className={styles.accounts}>
      {multiple && <p className={styles.label}>{accounts.length} accounts</p>}
      <ul className={styles.list} aria-label={`${symbol} token accounts`}>
        {accounts.map((account) => (
          <li key={account.address} className={styles.account}>
            {(multiple || account.frozen) && (
              <div className={styles.amount}>
                {multiple && (
                  <strong>
                    {formatUnits(account.amountRaw, account.decimals)} {symbol}
                  </strong>
                )}
                {account.frozen && <span className={styles.frozen}>Frozen</span>}
              </div>
            )}
            {!multiple && <span>Account </span>}
            <code>{account.address}</code>
          </li>
        ))}
      </ul>
      {multiple && (
        <p className={styles.note}>Use one account per transaction; balances cannot be combined.</p>
      )}
    </div>
  );
}

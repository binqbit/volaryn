import { formatUnits, type Wallet } from '../lib/api/client';
import { TokenAccounts } from './TokenAccounts';
import styles from './UsdcBalance.module.css';

export function UsdcBalance({
  wallet,
  mint,
  status,
}: {
  wallet: Wallet;
  mint: string;
  status: string;
}) {
  const accounts = wallet.accounts.filter((account) => account.mint === mint);
  const available = accounts
    .filter((account) => !account.frozen)
    .reduce((sum, account) => sum + BigInt(account.amountRaw), 0n);
  const frozen = accounts
    .filter((account) => account.frozen)
    .reduce((sum, account) => sum + BigInt(account.amountRaw), 0n);
  const currency = import.meta.env.MODE === 'localnet' ? 'test USDC' : 'USDC';
  return (
    <div className={styles.card} role="group" aria-label="USDC balance">
      <div className={styles.heading}>
        <span className={styles.icon} aria-hidden="true">
          $
        </span>
        <span>Available {currency}</span>
        <strong>{formatUnits(available.toString())}</strong>
      </div>
      <small>{status === 'error' ? 'Unavailable · last known' : 'Finalized wallet balance'}</small>
      {frozen > 0n && (
        <p>
          Frozen: {formatUnits(frozen.toString())} {currency} · excluded from available funds.
        </p>
      )}
      <TokenAccounts accounts={accounts} symbol={currency} />
    </div>
  );
}

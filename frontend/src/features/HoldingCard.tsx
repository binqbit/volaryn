import { formatUnits, type Asset, type TokenAccount } from '../lib/api/client';
import { TokenAccounts } from './TokenAccounts';
import styles from './HoldingCard.module.css';

export function HoldingCard({ asset, accounts }: { asset: Asset; accounts: TokenAccount[] }) {
  const total = accounts.reduce((sum, account) => sum + BigInt(account.amountRaw), 0n);
  const frozen = accounts
    .filter((account) => account.frozen)
    .reduce((sum, account) => sum + BigInt(account.amountRaw), 0n);
  const display = (value: bigint) => formatUnits(value.toString(), asset.decimals);
  return (
    <article className={styles.card} aria-label={`${asset.symbol} wallet balance`}>
      <div className={styles.heading}>
        <span className={styles.icon} aria-hidden="true">
          {asset.symbol.slice(0, 2)}
        </span>
        <div className={styles.identity}>
          <h4>{asset.symbol}</h4>
          <p>{asset.name}</p>
        </div>
        <strong className={styles.balance}>{display(total)}</strong>
      </div>
      {frozen > 0n && (
        <p className={styles.frozen}>
          Unfrozen {display(total - frozen)} · Frozen {display(frozen)}
        </p>
      )}
      <TokenAccounts accounts={accounts} symbol={asset.symbol} />
    </article>
  );
}

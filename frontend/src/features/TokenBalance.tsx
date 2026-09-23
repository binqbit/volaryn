import type { ReactNode } from 'react';
import { formatUnits, type TokenAccount } from '../lib/api/client';
import styles from './Balances.module.css';

/** Holdings are context; a transaction still spends from one chosen account. */
export function TokenBalance({
  symbol,
  decimals,
  accounts,
  status,
  children,
}: {
  symbol: string;
  decimals: number;
  accounts: TokenAccount[] | undefined;
  status: string;
  children: ReactNode;
}) {
  const total = accounts?.reduce((sum, account) => sum + BigInt(account.amountRaw), 0n);
  const frozen = accounts
    ?.filter((account) => account.frozen)
    .reduce((sum, account) => sum + BigInt(account.amountRaw), 0n);
  return (
    <div className={styles.holdings} role="group" aria-label={`${symbol} holdings`}>
      <div className={styles.heading}>
        <span>Your {symbol} balance</span>
        <small>
          {status === 'error'
            ? accounts
              ? 'Last known · unavailable'
              : 'Unavailable'
            : !accounts
              ? 'Loading'
              : 'Finalized'}
        </small>
      </div>
      <strong>
        {total === undefined
          ? status === 'error'
            ? 'Balance unavailable'
            : 'Loading balance…'
          : `${formatUnits(total.toString(), decimals)} ${symbol}`}
      </strong>
      {total !== undefined && frozen !== undefined && frozen > 0n && (
        <p>
          Unfrozen: {formatUnits((total - frozen).toString(), decimals)} {symbol} · Frozen:{' '}
          {formatUnits(frozen.toString(), decimals)} {symbol}
        </p>
      )}
      <p>{children}</p>
    </div>
  );
}

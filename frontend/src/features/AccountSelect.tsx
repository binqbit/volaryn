import { formatUnits, shortAddress, type TokenAccount } from '../lib/api/client';
import styles from '../App.module.css';
import balances from './Balances.module.css';

export function chooseAccount(accounts: TokenAccount[], selected: string) {
  return (
    accounts.find((account) => account.address === selected && !account.frozen) ??
    [...accounts]
      .filter((account) => !account.frozen)
      .sort((a, b) => (BigInt(a.amountRaw) > BigInt(b.amountRaw) ? -1 : 1))[0]
  );
}

export function AccountSelect({
  label,
  accounts,
  selected,
  onChange,
  symbol,
  decimals,
  status,
  required,
  requiredLabel = 'Required for this action',
  unscaled = false,
  onUseBalance,
}: {
  label: string;
  accounts: TokenAccount[] | undefined;
  selected: string;
  onChange: (value: string) => void;
  symbol: string;
  decimals: number;
  status: string;
  required?: bigint;
  requiredLabel?: string;
  unscaled?: boolean;
  onUseBalance?: (raw: string) => void;
}) {
  const account = chooseAccount(accounts ?? [], selected);
  const available = accounts ? BigInt(account?.amountRaw ?? '0') : undefined;
  const shortfall = available !== undefined && required !== undefined && available < required;
  const display = (raw: bigint) => `${formatUnits(raw.toString(), decimals)} ${symbol}`;
  return (
    <div className={balances.accountField}>
      <label className={styles.field}>
        <span>{label}</span>
        <select value={account?.address ?? ''} onChange={(event) => onChange(event.target.value)}>
          {!account && (
            <option value="">
              {accounts
                ? 'No usable token account'
                : status === 'error'
                  ? 'Accounts unavailable'
                  : 'Loading token accounts…'}
            </option>
          )}
          {accounts?.map((item) => (
            <option key={item.address} value={item.address} disabled={item.frozen}>
              {formatUnits(item.amountRaw, item.decimals)} {symbol} · {shortAddress(item.address)}
              {item.frozen ? ' · frozen' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className={balances.account} role="group" aria-label={`${label} balance`}>
        <dl>
          <div>
            <dt>
              {status === 'error'
                ? 'Last known in selected account'
                : 'Available in selected account'}
            </dt>
            <dd>
              {available === undefined
                ? status === 'error'
                  ? 'Unavailable'
                  : 'Loading…'
                : display(available)}
            </dd>
          </div>
          {required !== undefined && (
            <div>
              <dt>{requiredLabel}</dt>
              <dd>{display(required)}</dd>
            </div>
          )}
          {required !== undefined && available !== undefined && (
            <div>
              <dt>{shortfall ? 'Shortfall' : 'Remaining after this action'}</dt>
              <dd className={shortfall ? balances.shortfall : undefined}>
                {display(shortfall ? required - available : available - required)}
              </dd>
            </div>
          )}
        </dl>
        {unscaled && (
          <p>All token amounts above are unscaled, before the issuer's display multiplier.</p>
        )}
        {status === 'error' && <p>Balance unavailable. Refresh observations before continuing.</p>}
        {shortfall && (
          <p className={balances.shortfall}>The selected account cannot cover this amount.</p>
        )}
        {(accounts?.length ?? 0) > 1 && (
          <p>
            This action uses one selected account; separate balances and frozen funds are not
            combined.
          </p>
        )}
        {onUseBalance && (
          <button
            className={balances.max}
            type="button"
            disabled={!account || available === 0n || status !== 'success'}
            onClick={() => account && onUseBalance(account.amountRaw)}
          >
            Use full {symbol} balance
          </button>
        )}
      </div>
    </div>
  );
}

import { formatUnits, shortAddress, type TokenAccount } from '../lib/api/client';
import styles from '../App.module.css';

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
}: {
  label: string;
  accounts: TokenAccount[];
  selected: string;
  onChange: (value: string) => void;
}) {
  const account = chooseAccount(accounts, selected);
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select value={account?.address ?? ''} onChange={(event) => onChange(event.target.value)}>
        {!account && <option value="">No usable token account</option>}
        {accounts.map((item) => (
          <option key={item.address} value={item.address} disabled={item.frozen}>
            {formatUnits(item.amountRaw, item.decimals)} · {shortAddress(item.address)}
            {item.frozen ? ' · frozen' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

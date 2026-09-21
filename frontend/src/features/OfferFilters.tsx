import { useState, type FormEvent } from 'react';
import { parseUnits, formatUnits } from '../lib/api/client';
import type { PortfolioQuery } from './usePortfolio';
import styles from '../App.module.css';

export function OfferFilters({
  value,
  onChange,
}: {
  value: PortfolioQuery;
  onChange: (value: PortfolioQuery) => void;
}) {
  const [quantity, setQuantity] = useState(() =>
    value.quantityRaw ? formatUnits(value.quantityRaw) : '',
  );
  const [payout, setPayout] = useState(() => (value.minPayout ? formatUnits(value.minPayout) : ''));
  const [premium, setPremium] = useState(() =>
    value.maxPremium ? formatUnits(value.maxPremium) : '',
  );
  const [error, setError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const parse = (value: string) => (value ? parseUnits(value).toString() : undefined);
      onChange({
        mode: 'offers',
        quantityRaw: parse(quantity),
        minPayout: parse(payout),
        maxPremium: parse(premium),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid filter');
    }
  }
  return (
    <form onSubmit={submit} aria-label="Find protection" className={styles.offerForm}>
      <p className={styles.note}>
        Find funded offers for the supported demo asset. Quantity must match exactly; an offer
        cannot be resized. Connected-wallet searches include unrestricted offers and offers reserved
        for your address.
      </p>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Exact quantity (raw-token units)</span>
          <input
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="Any quantity"
          />
        </label>
        <label className={styles.field}>
          <span>Minimum payout (USDC)</span>
          <input
            inputMode="decimal"
            value={payout}
            onChange={(event) => setPayout(event.target.value)}
            placeholder="Any payout"
          />
        </label>
        <label className={styles.field}>
          <span>Maximum premium (USDC)</span>
          <input
            inputMode="decimal"
            value={premium}
            onChange={(event) => setPremium(event.target.value)}
            placeholder="Any premium"
          />
        </label>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button className={styles.outlineButton}>Find matching offers</button>
    </form>
  );
}

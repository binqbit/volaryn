import { useEffect, useState, type FormEvent } from 'react';
import { parseUnits, formatUnits, type Asset } from '../lib/api/client';
import type { PortfolioQuery } from './usePortfolio';
import { AssetSelect } from './AssetSelect';
import { Details } from './Details';
import styles from '../App.module.css';

export function OfferFilters({
  value,
  assets,
  onChange,
}: {
  value: PortfolioQuery;
  assets: Asset[];
  onChange: (value: PortfolioQuery) => void;
}) {
  const asset = assets.find((item) => item.mint === value.mint);
  const [quantity, setQuantity] = useState(() =>
    value.quantityRaw ? formatUnits(value.quantityRaw, asset?.decimals) : '',
  );
  const [payout, setPayout] = useState(() => (value.minPayout ? formatUnits(value.minPayout) : ''));
  const [premium, setPremium] = useState(() =>
    value.maxPremium ? formatUnits(value.maxPremium) : '',
  );
  const [error, setError] = useState('');
  useEffect(() => {
    setQuantity(value.quantityRaw ? formatUnits(value.quantityRaw, asset?.decimals) : '');
    setPayout(value.minPayout ? formatUnits(value.minPayout) : '');
    setPremium(value.maxPremium ? formatUnits(value.maxPremium) : '');
    setError('');
  }, [value.mint, value.quantityRaw, value.minPayout, value.maxPremium, asset?.decimals]);
  const applied = [value.quantityRaw, value.minPayout, value.maxPremium].filter(Boolean).length;
  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const parse = (value: string) => (value ? parseUnits(value).toString() : undefined);
      onChange({
        mode: 'offers',
        mint: value.mint,
        quantityRaw:
          quantity && asset ? parseUnits(quantity, asset.decimals).toString() : undefined,
        minPayout: parse(payout),
        maxPremium: parse(premium),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid filter');
    }
  }
  return (
    <form onSubmit={submit} aria-label="Find protection" className={styles.filterForm}>
      <AssetSelect
        assets={assets}
        value={value.mint ?? ''}
        allowAll
        onChange={(mint) => {
          setQuantity('');
          setError('');
          onChange({ ...value, mint: mint || undefined, quantityRaw: undefined });
        }}
      />
      <Details
        title="More filters"
        hint={applied ? `${applied} applied` : 'Quantity, payout & premium'}
      >
        <p className={styles.note}>
          Quantities exclude the issuer's display multiplier. Offers have a fixed quantity and
          cannot be resized.
        </p>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span>Exact quantity (unscaled tokens)</span>
            <input
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              disabled={!asset}
              placeholder={asset ? 'Any quantity' : 'Select a token first'}
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
        <div className={styles.actions}>
          <button className={styles.outlineButton}>Find matching offers</button>
        </div>
      </Details>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {(value.mint || applied > 0) && (
        <button
          className={styles.textButton}
          type="button"
          onClick={() => {
            setQuantity('');
            setPayout('');
            setPremium('');
            setError('');
            onChange({ mode: 'offers' });
          }}
        >
          Reset filters
        </button>
      )}
    </form>
  );
}

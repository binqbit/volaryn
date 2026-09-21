import { useState, type FormEvent } from 'react';
import { address } from '@solana/kit';
import { parseUnits, type Deployment, type Wallet } from '../lib/api/client';
import type { ActionRequest } from '../lib/chain/actionTypes';
import { AccountSelect, chooseAccount } from './AccountSelect';
import styles from '../App.module.css';

const initialDate = (seconds: number) =>
  new Date(Date.now() + seconds * 1000).toISOString().slice(0, 19);
export function utcSeconds(value: string) {
  const milliseconds = Date.parse(`${value}Z`);
  if (!Number.isFinite(milliseconds) || milliseconds < 0)
    throw new Error('Enter a valid UTC deadline');
  return BigInt(Math.floor(milliseconds / 1000)).toString();
}

export function OfferForm({
  wallet,
  deployment,
  busy,
  onReview,
}: {
  wallet: Wallet;
  deployment: Deployment;
  busy: boolean;
  onReview: (request: ActionRequest) => Promise<void>;
}) {
  const [quantity, setQuantity] = useState('1');
  const [payout, setPayout] = useState('20');
  const [premium, setPremium] = useState('0.5');
  const [acceptBefore, setAcceptBefore] = useState(() => initialDate(3600));
  const [expiresAt, setExpiresAt] = useState(() => initialDate(7200));
  const [designated, setDesignated] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const accounts = wallet.accounts.filter((account) => account.mint === deployment.usdcMint);
  const account = chooseAccount(accounts, selected);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (!account) throw new Error('A USDC token account is required');
      if (designated.trim()) address(designated.trim());
      const nonce = crypto.getRandomValues(new BigUint64Array(1))[0]!.toString();
      await onReview({
        operation: 'create',
        usdcAccount: account.address,
        terms: {
          nonce,
          quantityRaw: parseUnits(quantity).toString(),
          payout: parseUnits(payout).toString(),
          premium: parseUnits(premium).toString(),
          acceptBefore: utcSeconds(acceptBefore),
          expiresAt: utcSeconds(expiresAt),
          designatedHolder: designated.trim() || null,
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to review this offer');
    }
  }
  return (
    <form
      className={styles.offerForm}
      onSubmit={(event) => {
        void submit(event);
      }}
      aria-label="Create an offer"
    >
      <h3>Create an offer</h3>
      <p className={styles.note}>
        Set fixed terms for the demo asset. The complete USDC payout is reserved when you sign. The
        premium is paid by the holder only on activation.
      </p>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Gross quantity (raw-token units)</span>
          <input
            required
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Payout (USDC)</span>
          <input
            required
            inputMode="decimal"
            value={payout}
            onChange={(event) => setPayout(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Premium (USDC)</span>
          <input
            required
            inputMode="decimal"
            value={premium}
            onChange={(event) => setPremium(event.target.value)}
          />
        </label>
        <AccountSelect
          label="Funding USDC account"
          accounts={accounts}
          selected={selected}
          onChange={setSelected}
        />
        <label className={styles.field}>
          <span>Acceptance deadline (UTC)</span>
          <input
            type="datetime-local"
            step="1"
            required
            value={acceptBefore}
            onChange={(event) => setAcceptBefore(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Protection expiry (UTC)</span>
          <input
            type="datetime-local"
            step="1"
            required
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
          />
        </label>
      </div>
      <label className={styles.field}>
        <span>Designated holder (optional)</span>
        <input
          value={designated}
          onChange={(event) => setDesignated(event.target.value)}
          placeholder="Leave empty for any eligible wallet"
          spellCheck={false}
        />
      </label>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button className={styles.primaryButton} disabled={busy || !account} type="submit">
        Review funded offer <span>↗</span>
      </button>
    </form>
  );
}

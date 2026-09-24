import { useRef, useState, type FormEvent } from 'react';
import { address } from '@solana/kit';
import {
  formatUnits,
  parseUnits,
  shortAddress,
  type Deployment,
  type Wallet,
} from '../lib/api/client';
import type { ActionRequest } from '../lib/chain/actionTypes';
import { AccountSelect, chooseAccount } from './AccountSelect';
import { AssetSelect } from './AssetSelect';
import { AssetIdentity } from './AssetIdentity';
import { TokenBalance } from './TokenBalance';
import { Details } from './Details';
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
  walletStatus,
  onReview,
}: {
  wallet: Wallet;
  deployment: Deployment;
  busy: boolean;
  walletStatus: string;
  onReview: (request: ActionRequest) => Promise<void>;
}) {
  const [mint, setMint] = useState('');
  const asset = deployment.assets.find((item) => item.mint === mint);
  const [quantity, setQuantity] = useState('1');
  const [payout, setPayout] = useState('20');
  const [premium, setPremium] = useState('0.5');
  const [acceptBefore, setAcceptBefore] = useState(() => initialDate(3600));
  const [expiresAt, setExpiresAt] = useState(() => initialDate(7200));
  const [designated, setDesignated] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const restriction = useRef<HTMLDetailsElement>(null);
  const accounts = wallet.accounts.filter((account) => account.mint === deployment.usdcMint);
  const account = chooseAccount(accounts, selected);
  let payoutRaw: bigint | undefined;
  try {
    payoutRaw = parseUnits(payout);
  } catch {
    // Invalid decimal input is explained on submit; never approximate an amount.
  }
  const insufficient =
    !!account && payoutRaw !== undefined && payoutRaw > BigInt(account.amountRaw);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    try {
      if (!asset) throw new Error('Choose the PreStocks token for this offer');
      if (!account) throw new Error('A USDC token account is required');
      const funding = parseUnits(payout);
      if (funding > BigInt(account.amountRaw))
        throw new Error('The selected USDC account cannot fund the full payout');
      if (designated.trim()) {
        if (designated.trim() === wallet.owner) {
          setError('The designated holder must be a different wallet from the writer.');
          if (restriction.current) {
            restriction.current.open = true;
            restriction.current.querySelector('input')?.focus();
          }
          return;
        }
        try {
          address(designated.trim());
        } catch {
          setError('Enter a valid designated holder wallet address.');
          if (restriction.current) {
            restriction.current.open = true;
            restriction.current.querySelector('input')?.focus();
          }
          return;
        }
      }
      const nonce = crypto.getRandomValues(new BigUint64Array(1))[0]!.toString();
      await onReview({
        operation: 'create',
        usdcAccount: account.address,
        terms: {
          nonce,
          underlyingMint: asset.mint,
          quantityRaw: parseUnits(quantity, asset.decimals).toString(),
          payout: funding.toString(),
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
      <fieldset className={styles.formSection}>
        <legend>Choose the token</legend>
        <AssetSelect assets={deployment.assets} value={mint} onChange={setMint} />
        {asset && (
          <>
            <TokenBalance
              symbol={asset.symbol}
              decimals={asset.decimals}
              accounts={wallet.accounts.filter((account) => account.mint === mint)}
              status={walletStatus}
            >
              You fund this offer with USDC. These tokens stay in your wallet.
            </TokenBalance>
            <AssetIdentity assets={deployment.assets} mint={mint} compact />
          </>
        )}
      </fieldset>
      <fieldset className={styles.formSection}>
        <legend>Set the terms</legend>
        <div className={`${styles.formGrid} ${styles.priceFields}`}>
          <label className={styles.field}>
            <span>Gross quantity (unscaled tokens)</span>
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
        </div>
        {asset && (
          <p className={styles.note}>
            Enter {asset.symbol} before the issuer's display multiplier. One unscaled token is{' '}
            {(10n ** BigInt(asset.decimals)).toString()} base units. Your external wallet may show a
            different scaled balance.
          </p>
        )}
        <div className={styles.formGrid}>
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
        <Details
          ref={restriction}
          title="Restrict to a wallet"
          hint={designated.trim() ? shortAddress(designated.trim()) : 'Optional'}
        >
          <label className={styles.field}>
            <span>Designated holder (optional)</span>
            <input
              value={designated}
              onChange={(event) => setDesignated(event.target.value)}
              placeholder="Leave empty for any eligible wallet"
              spellCheck={false}
            />
          </label>
          <p>
            Leave empty to let any eligible wallet accept. A restricted offer can be accepted only
            by this address.
          </p>
        </Details>
      </fieldset>
      <fieldset className={styles.formSection}>
        <legend>Fund the payout</legend>
        <p className={styles.note}>
          The full payout is reserved when you sign. You earn the premium when a holder accepts.
        </p>
        <AccountSelect
          label="Funding USDC account"
          accounts={accounts}
          selected={selected}
          onChange={setSelected}
          symbol="USDC"
          decimals={6}
          status={walletStatus}
          required={payoutRaw}
          requiredLabel="Payout to reserve"
          onUseBalance={(raw) => setPayout(formatUnits(raw))}
        />
      </fieldset>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <button
        className={styles.primaryButton}
        disabled={busy || !account || !asset || insufficient}
        type="submit"
      >
        Review funded offer <span>↗</span>
      </button>
    </form>
  );
}

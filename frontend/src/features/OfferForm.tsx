import { useRef, useState, type FormEvent } from 'react';
import { address } from '@solana/kit';
import { useSearchParams } from 'react-router';
import {
  formatUnits,
  parseUnits,
  shortAddress,
  type Deployment,
  type Wallet,
} from '../lib/api/client';
import type { ActionRequest, OfferSide } from '../lib/chain/actionTypes';
import { AccountSelect, chooseAccount } from './AccountSelect';
import { AssetSelect } from './AssetSelect';
import { AssetIdentity } from './AssetIdentity';
import { TokenBalance } from './TokenBalance';
import { Details } from './Details';
import { useOfferTerms } from './offers/useOfferTerms';
import { OfferTermsFields } from './offers/OfferTermsFields';
import { utcSeconds } from './offers/terms';
import styles from '../App.module.css';

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
  const [search] = useSearchParams();
  const [mint, setMint] = useState(
    () => deployment.assets.find((asset) => asset.mint === search.get('mint'))?.mint ?? '',
  );
  const [side, setSide] = useState<OfferSide>(() =>
    search.get('side') === 'writer' ? 'writer' : 'holder',
  );
  const asset = deployment.assets.find((item) => item.mint === mint);
  const terms = useOfferTerms(deployment, asset);
  const { quantity, payout, pricing, dates } = terms;
  const [designated, setDesignated] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const restriction = useRef<HTMLDetailsElement>(null);
  const accounts = wallet.accounts.filter((account) => account.mint === deployment.usdcMint);
  const account = chooseAccount(accounts, selected);
  let payoutRaw: bigint | undefined;
  try {
    payoutRaw = parseUnits(side === 'holder' ? pricing.premium : payout);
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
      if (terms.dateError) throw new Error(terms.dateError);
      if (pricing.error) throw new Error(pricing.error);
      if (!account) throw new Error('A USDC token account is required');
      const funding = parseUnits(side === 'holder' ? pricing.premium : payout);
      if (funding > BigInt(account.amountRaw))
        throw new Error(
          side === 'holder'
            ? 'The selected USDC account cannot escrow the full premium'
            : 'The selected USDC account cannot fund the full payout',
        );
      if (designated.trim()) {
        if (designated.trim() === wallet.owner) {
          setError('The designated counterparty must be a different wallet from the creator.');
          if (restriction.current) {
            restriction.current.open = true;
            restriction.current.querySelector('input')?.focus();
          }
          return;
        }
        try {
          address(designated.trim());
        } catch {
          setError('Enter a valid designated counterparty wallet address.');
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
          side,
          nonce,
          underlyingMint: asset.mint,
          quantityRaw: parseUnits(quantity, asset.decimals).toString(),
          payout: parseUnits(payout).toString(),
          premium: parseUnits(pricing.premium).toString(),
          acceptBefore: utcSeconds(dates.acceptBefore),
          expiresAt: utcSeconds(dates.expiresAt),
          designatedCounterparty: designated.trim() || null,
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
      <div className={styles.sideSwitch} role="group" aria-label="Offer side">
        <button type="button" aria-pressed={side === 'holder'} onClick={() => setSide('holder')}>
          Request protection
        </button>
        <button type="button" aria-pressed={side === 'writer'} onClick={() => setSide('writer')}>
          Provide protection
        </button>
      </div>
      <p className={styles.note}>
        {side === 'holder'
          ? 'Sell request: lock the premium for a provider to accept. Protection starts only when they fund the full payout. Your tokens stay in your wallet.'
          : 'Buy offer: reserve the full payout to buy these tokens if a holder exercises. You earn the premium when a holder accepts.'}
      </p>
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
              {side === 'holder'
                ? 'Your tokens stay in your wallet. Exercise later requires the full delivery quantity.'
                : 'You fund this offer with USDC. Existing token holdings do not limit the quantity you can offer to buy.'}
            </TokenBalance>
            <AssetIdentity assets={deployment.assets} mint={mint} compact />
          </>
        )}
      </fieldset>
      <fieldset className={styles.formSection}>
        <legend>Set the terms</legend>
        <OfferTermsFields terms={terms} asset={asset} side={side} />
        <Details
          ref={restriction}
          title="Restrict to a wallet"
          hint={designated.trim() ? shortAddress(designated.trim()) : 'Optional'}
        >
          <label className={styles.field}>
            <span>Designated counterparty (optional)</span>
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
        <legend>{side === 'holder' ? 'Escrow the premium' : 'Fund the payout'}</legend>
        <p className={styles.note}>
          {side === 'holder'
            ? 'The premium is held until a provider funds the payout. Cancel an unaccepted request to recover it.'
            : 'The full payout is reserved when you sign. You earn the premium when a holder accepts.'}
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
          requiredLabel={side === 'holder' ? 'Premium to escrow' : 'Payout to reserve'}
          onUseBalance={(raw) =>
            side === 'holder'
              ? terms.setPremium(formatUnits(raw))
              : terms.setPayout(formatUnits(raw))
          }
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
        {side === 'holder' ? 'Review protection request' : 'Review funded offer'} <span>↗</span>
      </button>
    </form>
  );
}

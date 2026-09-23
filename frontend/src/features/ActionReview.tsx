import { useEffect, useRef } from 'react';
import { formatUnits, shortAddress, type Asset } from '../lib/api/client';
import { actionLabels, type ActionReview as Review } from '../lib/chain/actionTypes';
import { AssetIdentity } from './AssetIdentity';
import { Details } from './Details';
import styles from '../App.module.css';

export const date = (seconds: string) =>
  new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(Number(seconds) * 1000)) + ' UTC';

export function ActionReview({
  assets,
  review,
  busy,
  onConfirm,
  onCancel,
}: {
  assets: Asset[];
  review: Review;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  const transfers = ['create', 'activate', 'exercise'].includes(review.operation);
  return (
    <dialog
      ref={dialog}
      className={styles.review}
      aria-labelledby="review-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <p className={styles.eyebrow}>REVIEW BEFORE SIGNING</p>
      <h2 id="review-title">{actionLabels[review.operation]}</h2>
      <p className={styles.note}>
        {review.operation === 'create'
          ? 'The full payout will leave your selected USDC account and be locked in this offer.'
          : review.operation === 'activate'
            ? 'You pay the premium now. Your underlying tokens stay in your wallet until you choose to exercise.'
            : review.operation === 'exercise'
              ? 'The full gross quantity leaves your selected account and the reserved USDC payout is delivered atomically.'
              : review.operation === 'cleanup'
                ? 'Recover any residual USDC and hand off an unused settlement account. This does not close the agreement record.'
                : 'Return the reserved payout to your selected USDC account. This is allowed only by the current agreement state.'}
      </p>
      <AssetIdentity assets={assets} mint={review.underlyingMint} />
      <dl className={styles.terms}>
        <div>
          <dt>Gross delivery</dt>
          <dd>{formatUnits(review.quantityRaw, review.underlyingDecimals)} raw-token units</dd>
        </div>
        <div>
          <dt>Contractual USDC payout</dt>
          <dd>{formatUnits(review.payout)} USDC</dd>
        </div>
        {review.reserveAmount !== null && (
          <div>
            <dt>USDC currently in reserve</dt>
            <dd>{formatUnits(review.reserveAmount)} USDC</dd>
          </div>
        )}
        {['cancel', 'reclaim', 'cleanup'].includes(review.operation) && (
          <div>
            <dt>USDC returned by this action</dt>
            <dd>
              {formatUnits(review.operation === 'cleanup' ? review.reserveAmount! : review.payout)}{' '}
              USDC
            </dd>
          </div>
        )}
        <div>
          <dt>Activation premium</dt>
          <dd>{formatUnits(review.premium)} USDC</dd>
        </div>
        {transfers && (
          <>
            <div>
              <dt>Estimated issuer fee at exercise</dt>
              <dd>{formatUnits(review.issuerFee, review.underlyingDecimals)} raw-token units</dd>
            </div>
            <div>
              <dt>Estimated net writer receipt</dt>
              <dd>
                {formatUnits(review.estimatedNetReceipt, review.underlyingDecimals)} raw-token units
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>Acceptance deadline</dt>
          <dd>{date(review.acceptBefore)}</dd>
        </div>
        <div>
          <dt>Protection expires</dt>
          <dd>{date(review.expiresAt)}</dd>
        </div>
        <div>
          <dt>Estimated network fee</dt>
          <dd>{formatUnits(review.networkFee, 9)} SOL</dd>
        </div>
        <div>
          <dt>New account rent</dt>
          <dd>{formatUnits(review.accountRent, 9)} SOL</dd>
        </div>
      </dl>
      {review.operation === 'create' && (
        <p className={styles.note}>
          Eligible holder: <code>{review.designatedHolder ?? 'Any eligible wallet'}</code>
        </p>
      )}
      <Details title="Transaction accounts" hint={`Wallet ${shortAddress(review.owner)}`}>
        <p className={styles.note}>
          Signing wallet <code>{review.owner}</code>
        </p>
        <p className={styles.note}>
          USDC account <code>{review.usdcAccount}</code>
        </p>
        {review.underlyingAccount && (
          <p className={styles.note}>
            Delivery source <code>{review.underlyingAccount}</code>
          </p>
        )}
      </Details>
      {transfers && (
        <ul className={styles.restrictions}>
          {review.restrictions.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}
      <p className={styles.note}>
        Values are in unscaled token units. Fee estimates can change; eligibility is checked again
        before signing. Network fees can apply to a rejected on-chain transaction.
      </p>
      <div className={styles.actions}>
        <button className={styles.outlineButton} disabled={busy} onClick={onCancel}>
          Back
        </button>
        <button className={styles.primaryButton} disabled={busy} onClick={onConfirm}>
          {busy ? 'Waiting for wallet…' : 'Confirm and sign'}
        </button>
      </div>
    </dialog>
  );
}

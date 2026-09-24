import { Link } from 'react-router';
import { formatUnits, shortAddress, type Asset, type Agreement } from '../lib/api/client';
import { date } from './ActionReview';
import { agreementLifecycle } from './agreementLifecycle';
import styles from '../App.module.css';
import { OfferSideBadge } from './OfferSideBadge';

export function AgreementCard({
  agreement,
  assets,
  owner,
  now,
}: {
  agreement: Agreement;
  assets: Asset[];
  owner?: string;
  now: bigint | undefined;
}) {
  const asset = assets.find((item) => item.mint === agreement.underlyingMint);
  const open = agreement.status === 'open';
  const status = agreementLifecycle(agreement, now);
  return (
    <article className={styles.offerCard} aria-label={`Agreement ${agreement.address}`}>
      <div className={styles.cardHeading}>
        <OfferSideBadge side={agreement.side} />
        <span className={styles.smallTag}>
          {import.meta.env.MODE === 'localnet' ? 'PRESTOCKS · LOCAL DEMO' : 'PRESTOCKS'}
        </span>
        <span className={styles.status} data-state={status.open ? 'open' : 'closed'}>
          {status.label}
        </span>
      </div>
      <h2>
        {asset?.name ?? shortAddress(agreement.underlyingMint)}{' '}
        <span>
          {asset?.symbol ?? 'Unlisted asset'} ·{' '}
          {open && agreement.side === 'holder'
            ? 'Awaiting payout funding'
            : open
              ? 'Payout reserved'
              : 'Fixed exit terms'}
        </span>
      </h2>
      <div className={styles.cardPayout}>
        <span>Fixed payout</span>
        <strong>
          {formatUnits(agreement.payout)} <small>USDC</small>
        </strong>
      </div>
      <dl className={styles.cardTerms}>
        <div>
          <dt>Quantity · unscaled tokens</dt>
          <dd>{formatUnits(agreement.quantityRaw, agreement.underlyingDecimals)}</dd>
        </div>
        <div>
          <dt>Premium</dt>
          <dd>{formatUnits(agreement.premium)} USDC</dd>
        </div>
        <div>
          <dt>Protection expires</dt>
          <dd>{date(agreement.expiresAt)}</dd>
        </div>
        {open && (
          <div>
            <dt>Accept before</dt>
            <dd>{date(agreement.acceptBefore)}</dd>
          </div>
        )}
      </dl>
      <p className={styles.cardOwner}>
        {agreement.creator === owner && open
          ? agreement.side === 'holder'
            ? 'Requested by your wallet · premium escrowed'
            : 'Written by your wallet'
          : agreement.writer === owner
            ? 'Written by your wallet'
            : agreement.holder === owner
              ? open || agreement.status === 'cancelled'
                ? 'Requested by your wallet'
                : 'Protection purchased by your wallet'
              : `${agreement.side === 'holder' ? 'Requester' : 'Writer'} ${shortAddress(agreement.creator)}`}
        {open && (
          <span>
            {agreement.designatedCounterparty
              ? agreement.designatedCounterparty === owner
                ? 'Reserved for your wallet'
                : 'Reserved for a designated wallet'
              : 'Open to eligible wallets'}
          </span>
        )}
      </p>
      <Link className={styles.cardLink} to={`/agreements/${agreement.address}`}>
        {open ? 'View offer' : 'View agreement'} <span aria-hidden="true">↗</span>
      </Link>
    </article>
  );
}

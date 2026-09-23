import { shortAddress } from '../lib/api/client';
import type { components } from '../lib/api/schema';
import { Details } from './Details';
import styles from './OfficialAssets.module.css';

const eligibilityLabels: Record<components['schemas']['Eligibility'], string> = {
  compatible: 'Compatible',
  unsupported: 'Unsupported',
  unreviewed: 'Not reviewed',
  expired: 'Review expired',
  stale: 'Needs refresh',
  unavailable: 'Unavailable',
};

export function OfficialAssetCard({
  asset,
  unavailable,
}: {
  asset: components['schemas']['OfficialAsset'];
  unavailable: boolean;
}) {
  const eligibility =
    unavailable && asset.eligibility === 'compatible' ? 'stale' : asset.eligibility;
  const policy = asset.policy;
  return (
    <article className={styles.asset} aria-label={`${asset.symbol} official asset`}>
      <div className={styles.identity}>
        <span className={styles.icon} aria-hidden="true">
          {asset.symbol.slice(0, 2)}
        </span>
        <div>
          <span className={styles.symbol}>{asset.symbol}</span>
          <h3>{asset.name}</h3>
        </div>
      </div>
      <span className={styles.eligibility} data-state={eligibility}>
        {eligibilityLabels[eligibility]}
      </span>
      <dl className={styles.prices}>
        <div>
          <dt>Token price · source value</dt>
          <dd>{asset.market?.tokenPrice ?? 'Unavailable'}</dd>
        </div>
        <div>
          <dt>Mark price · source value</dt>
          <dd>{asset.market?.markPrice ?? 'Unavailable'}</dd>
        </div>
      </dl>
      <p className={styles.reason}>{asset.reason}</p>
      {policy?.conversionDeadline != null && (
        <p className={styles.notice}>
          Issuer conversion deadline: {new Date(policy.conversionDeadline * 1000).toUTCString()}.
          Protection must end at least {policy.expiryBufferSeconds} seconds earlier.
        </p>
      )}
      <Details title="Asset details" hint={shortAddress(asset.mint)}>
        <p>
          Mainnet mint <code>{asset.mint}</code>
        </p>
        <dl className={styles.values}>
          <div>
            <dt>Implied valuation · source value</dt>
            <dd>{asset.market?.impliedValuation ?? 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Mark valuation · source value</dt>
            <dd>{asset.market?.markValuation ?? 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Supply · source value</dt>
            <dd>{asset.market?.supply ?? 'Unavailable'}</dd>
          </div>
        </dl>
        {policy && (
          <p>
            Reviewed expiry limit: {new Date(policy.maxExpiry * 1000).toUTCString()}. Review valid
            until {new Date(policy.reviewedUntil * 1000).toUTCString()}.
          </p>
        )}
      </Details>
      {asset.chain && (
        <Details title="Verified token behavior">
          <dl className={styles.values}>
            <div>
              <dt>Decimals</dt>
              <dd>{asset.chain.decimals}</dd>
            </div>
            <div>
              <dt>Current issuer fee</dt>
              <dd>
                {asset.chain.currentFee
                  ? `${asset.chain.currentFee.basisPoints} basis points; cap ${asset.chain.currentFee.maximumRaw} raw units`
                  : 'No transfer-fee extension'}
              </dd>
            </div>
            {asset.chain.nextFee && (
              <div>
                <dt>Scheduled fee</dt>
                <dd>
                  {asset.chain.nextFee.basisPoints} basis points from epoch{' '}
                  {asset.chain.nextFee.epoch}
                </dd>
              </div>
            )}
            <div>
              <dt>Display multiplier</dt>
              <dd>{asset.chain.displayMultiplier ?? 'No scaling extension'}</dd>
            </div>
          </dl>
          <p>
            Gross obligations use raw base units. A display multiplier changes presentation; it does
            not change that obligation.
          </p>
          <p>{asset.chain.restrictions.join('. ')}.</p>
          <p>Extensions: {asset.chain.extensions.join(', ')}.</p>
        </Details>
      )}
      {policy && (
        <a className={styles.assetLink} href={policy.source} target="_blank" rel="noreferrer">
          View on PreStocks <span aria-hidden="true">↗</span>
        </a>
      )}
    </article>
  );
}

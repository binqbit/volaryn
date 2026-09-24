import { shortAddress } from '../lib/api/client';
import type { components } from '../lib/api/schema';
import { InfoPopover } from './InfoPopover';
import {
  formatBuffer,
  formatPolicyDate,
  formatSourcePrice,
  protectionDeadline,
} from './officialAssetPresentation';
import styles from './OfficialAssets.module.css';
import info from './InfoContent.module.css';

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
  sharedRestrictions,
}: {
  asset: components['schemas']['OfficialAsset'];
  unavailable: boolean;
  sharedRestrictions: readonly string[];
}) {
  const eligibility =
    unavailable && asset.eligibility === 'compatible' ? 'stale' : asset.eligibility;
  const policy = asset.policy;
  const restrictions =
    asset.chain?.restrictions.filter((rule) => !sharedRestrictions.includes(rule)) ?? [];
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
          <dd>{formatSourcePrice(asset.market?.tokenPrice)}</dd>
        </div>
        <div>
          <dt>Mark price · source value</dt>
          <dd>{formatSourcePrice(asset.market?.markPrice)}</dd>
        </div>
      </dl>
      {asset.eligibility !== 'compatible' && <p className={styles.reason}>{asset.reason}</p>}
      {policy?.conversionDeadline != null && (
        <dl className={styles.deadlines}>
          <div>
            <dt>Issuer conversion</dt>
            <dd>
              <time dateTime={new Date(policy.conversionDeadline * 1000).toISOString()}>
                {formatPolicyDate(policy.conversionDeadline)}
              </time>
            </dd>
          </div>
          <div>
            <dt>Latest protection expiry</dt>
            <dd>
              <time dateTime={new Date(protectionDeadline(policy) * 1000).toISOString()}>
                {formatPolicyDate(protectionDeadline(policy))}
              </time>
            </dd>
          </div>
        </dl>
      )}
      <div className={styles.cardFooter}>
        <InfoPopover title="Asset details" context={asset.name} hint={shortAddress(asset.mint)}>
          {unavailable && (
            <p className={info.note} data-tone="warning" role="status">
              Last known observations · refresh unavailable.
            </p>
          )}
          <section className={info.section}>
            <dl className={info.addresses}>
              <div>
                <dt>Mainnet mint</dt>
                <dd>
                  <code>{asset.mint}</code>
                </dd>
              </div>
            </dl>
          </section>
          <section className={info.section}>
            <h3>Full source values</h3>
            <dl className={info.facts}>
              {(
                [
                  ['tokenPrice', 'Token price'],
                  ['markPrice', 'Mark price'],
                  ['impliedValuation', 'Implied valuation'],
                  ['markValuation', 'Mark valuation'],
                  ['supply', 'Supply'],
                ] as const
              ).map(([field, label]) => (
                <div key={field}>
                  <dt>{label}</dt>
                  <dd data-unavailable={asset.market?.[field] == null}>
                    {asset.market?.[field] ?? 'Unavailable'}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          {policy && (
            <section className={info.section}>
              <h3>Protection limits · UTC</h3>
              <dl className={info.facts}>
                {policy.conversionDeadline != null && (
                  <div>
                    <dt>Issuer conversion</dt>
                    <dd>{new Date(policy.conversionDeadline * 1000).toUTCString()}</dd>
                  </div>
                )}
                <div>
                  <dt>Latest protection expiry</dt>
                  <dd>{new Date(protectionDeadline(policy) * 1000).toUTCString()}</dd>
                </div>
                <div>
                  <dt>Reviewed expiry limit</dt>
                  <dd>{new Date(policy.maxExpiry * 1000).toUTCString()}</dd>
                </div>
                <div>
                  <dt>Review valid until</dt>
                  <dd>{new Date(policy.reviewedUntil * 1000).toUTCString()}</dd>
                </div>
              </dl>
              {policy.conversionDeadline != null && (
                <p className={info.note}>
                  Protection must end at least {formatBuffer(policy.expiryBufferSeconds)} earlier
                  than issuer conversion and within the reviewed expiry limit.
                </p>
              )}
            </section>
          )}
        </InfoPopover>
        {asset.chain && (
          <InfoPopover title="Verified token behavior" context={asset.name}>
            {unavailable && (
              <p className={info.note} data-tone="warning" role="status">
                Last known observations · refresh unavailable.
              </p>
            )}
            <section className={info.section}>
              <h3>Transfer fees</h3>
              {asset.chain.currentFee ? (
                <dl className={info.facts}>
                  <div>
                    <dt>Current issuer fee</dt>
                    <dd>
                      {asset.chain.currentFee.basisPoints} <small>basis points</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Maximum fee</dt>
                    <dd>
                      {asset.chain.currentFee.maximumRaw} <small>raw units</small>
                    </dd>
                  </div>
                </dl>
              ) : (
                <p>No transfer-fee extension</p>
              )}
              {asset.chain.nextFee && (
                <dl className={info.facts}>
                  <div>
                    <dt>Scheduled fee</dt>
                    <dd>
                      {asset.chain.nextFee.basisPoints} basis points
                      <small>from epoch {asset.chain.nextFee.epoch}</small>
                    </dd>
                  </div>
                </dl>
              )}
            </section>
            <section className={info.section}>
              <h3>Token units</h3>
              <dl className={info.facts}>
                <div>
                  <dt>Decimals</dt>
                  <dd>{asset.chain.decimals}</dd>
                </div>
                <div>
                  <dt>Display multiplier</dt>
                  <dd>{asset.chain.displayMultiplier ?? 'No scaling extension'}</dd>
                </div>
              </dl>
            </section>
            {restrictions.length > 0 && (
              <section className={info.section}>
                <h3>Issuer restrictions</h3>
                <ul className={info.rules} data-tone="warning">
                  {restrictions.map((rule) => (
                    <li key={rule}>{rule}.</li>
                  ))}
                </ul>
              </section>
            )}
            <section className={info.section}>
              <h3>Mint extensions</h3>
              <ul className={info.tags}>
                {asset.chain.extensions.map((extension) => (
                  <li key={extension}>{extension}</li>
                ))}
              </ul>
            </section>
          </InfoPopover>
        )}
        {policy && (
          <a className={styles.assetLink} href={policy.source} target="_blank" rel="noreferrer">
            View on PreStocks <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
    </article>
  );
}

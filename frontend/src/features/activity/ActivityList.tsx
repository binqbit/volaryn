import { Link } from 'react-router';
import type { Deployment } from '../../lib/api/client';
import { formatUnits, shortAddress } from '../../lib/api/client';
import { actionLabels } from '../../lib/chain/actionTypes';
import { inFlight, statusLabels, type ActivityItem } from './model';
import styles from './ActivityList.module.css';

export function ActivityList({
  items,
  deployment,
  title = 'Operation history',
}: {
  items: ActivityItem[];
  deployment: Deployment;
  title?: string;
}) {
  if (!items.length) return null;
  return (
    <section className={styles.history} aria-label={title}>
      <h2>{title}</h2>
      <ol>
        {items.map((item) => {
          const terms = item.createdTerms;
          const asset = deployment.assets.find((asset) => asset.mint === terms?.underlyingMint);
          return (
            <li key={item.signature ?? item.id}>
              <div className={styles.heading}>
                <strong>{actionLabels[item.operation]}</strong>
                <span className={styles.status} data-pending={inFlight(item)}>
                  {statusLabels[item.status]}
                </span>
              </div>
              {terms && (
                <p>
                  {asset
                    ? `${formatUnits(terms.quantityRaw, asset.decimals)} unscaled`
                    : `${terms.quantityRaw} base units`}{' '}
                  {asset?.symbol ?? shortAddress(terms.underlyingMint)} ·{' '}
                  {formatUnits(terms.payout)} USDC payout · {formatUnits(terms.premium)} USDC
                  premium
                </p>
              )}
              {item.error && <p>{item.error}</p>}
              {item.status === 'reconciled' && (
                <p>
                  The finalized agreement proves the action. Its transaction history is unavailable.
                </p>
              )}
              {item.status === 'unresolved' && (
                <p>
                  Checking the original signature before another submission. No second signature is
                  requested.
                </p>
              )}
              <div className={styles.meta}>
                <time dateTime={new Date(item.createdAt).toISOString()}>
                  {new Date(item.createdAt).toLocaleString()}
                </time>
                <Link
                  to={
                    item.operation === 'create' && !item.signature
                      ? '/offers/new'
                      : `/agreements/${item.agreement}`
                  }
                >
                  {item.operation === 'create' && !item.signature
                    ? 'Review a new offer'
                    : 'View agreement'}{' '}
                  ↗
                </Link>
              </div>
              {item.signature ? (
                <p className={styles.identity}>
                  {item.source === 'browser'
                    ? 'Saved in this browser · transaction'
                    : 'Transaction'}{' '}
                  <code>{item.signature}</code>
                </p>
              ) : (
                <p className={styles.identity}>Unsigned attempt · saved in this browser</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

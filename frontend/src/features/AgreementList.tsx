import { Link, useLocation } from 'react-router';
import type { usePortfolio } from './usePortfolio';
import { AgreementCard } from './AgreementCard';
import type { Asset } from '../lib/api/client';
import styles from '../App.module.css';

export function AgreementList({
  assets,
  portfolio,
  owner,
  now,
  emptyTitle,
  emptyDescription,
  hideEmpty = false,
}: {
  assets: Asset[];
  portfolio: ReturnType<typeof usePortfolio>;
  owner?: string;
  now: bigint | undefined;
  emptyTitle: string;
  emptyDescription: string;
  hideEmpty?: boolean;
}) {
  const location = useLocation();
  const { data, status, refresh } = portfolio;
  const params = new URLSearchParams(location.search);
  const after = params.get('after');
  const pageUrl = (cursor?: string | null) => {
    const query = new URLSearchParams(location.search);
    query.delete('after');
    if (cursor) query.set('after', cursor);
    return `${location.pathname}${query.size ? `?${query}` : ''}`;
  };
  return (
    <>
      {status === 'error' && (
        <div className={styles.error} role="alert">
          Offers could not be refreshed. Any displayed terms are last known observations.
          <button onClick={() => refresh()}>Try again</button>
        </div>
      )}
      {status === 'fetching' && !data && (
        <div className={styles.emptyState} role="status">
          Loading agreements…
        </div>
      )}
      {!hideEmpty && status === 'success' && data?.agreements.length === 0 && (
        <div className={styles.emptyState}>
          <span aria-hidden="true">◇</span>
          <h2>{emptyTitle}</h2>
          <p>{emptyDescription}</p>
        </div>
      )}
      <div className={styles.offerGrid}>
        {data?.agreements.map((agreement) => (
          <AgreementCard
            assets={assets}
            key={agreement.address}
            agreement={agreement}
            owner={owner}
            now={now}
          />
        ))}
      </div>
      {(after || data?.next) && (
        <nav className={styles.agreementPages} aria-label="Agreement pages">
          {after && <Link to={pageUrl()}>First page</Link>}
          {data?.next && <Link to={pageUrl(data.next)}>Next agreements →</Link>}
        </nav>
      )}
    </>
  );
}

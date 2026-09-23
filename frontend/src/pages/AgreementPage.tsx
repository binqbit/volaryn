import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { useClient } from '@solana/react';
import type { Deployment, Wallet } from '../lib/api/client';
import type { AppClient } from '../lib/chain/client';
import type { ActionRequest } from '../lib/chain/actionTypes';
import { usePortfolio } from '../features/usePortfolio';
import { useChainTime } from '../features/useChainTime';
import { AgreementPanel } from '../features/AgreementPanel';
import styles from '../App.module.css';

export function AgreementPage({
  deployment,
  owner,
  wallet,
  walletStatus,
  usable,
  revision,
  onReview,
}: {
  deployment: Deployment;
  owner?: string;
  wallet?: Wallet;
  walletStatus: string;
  usable: boolean;
  revision: number;
  onReview: (request: ActionRequest) => Promise<void>;
}) {
  const { address } = useParams();
  const client = useClient<AppClient>();
  const now = useChainTime(client);
  const portfolio = usePortfolio(deployment, owner, address);
  const { refresh } = portfolio;
  useEffect(() => {
    if (revision) refresh();
  }, [revision, refresh]);
  return (
    <>
      <div className={styles.actions}>
        <Link className={styles.backLink} to="/offers">
          ← Explore offers
        </Link>
        <Link className={styles.backLink} to="/portfolio">
          My portfolio ↗
        </Link>
      </div>
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>TERMS & SETTLEMENT</p>
          <h1>Agreement details</h1>
          <p>Review the full terms and the actions available to your connected wallet.</p>
        </div>
      </div>
      {portfolio.status === 'error' && (
        <div className={styles.error} role="alert">
          Agreement data is unavailable. Displayed observations may be stale; actions are paused.
          <button onClick={() => refresh()}>Refresh agreement</button>
        </div>
      )}
      {!portfolio.data && portfolio.status === 'fetching' && (
        <p role="status">Loading agreement…</p>
      )}
      {portfolio.status === 'success' && portfolio.data?.agreements.length === 0 && (
        <div className={styles.emptyState} role="status">
          <h2>No finalized agreement yet</h2>
          <p>
            This address has no finalized agreement on this network. Newly signed offers appear
            after finalization; this page checks automatically.
          </p>
          <button className={styles.outlineButton} onClick={() => refresh()}>
            Refresh agreement
          </button>
        </div>
      )}
      {portfolio.data?.agreements.map((agreement) => (
        <div className={styles.surface} key={agreement.address}>
          <AgreementPanel
            assets={deployment.assets}
            agreement={agreement}
            owner={owner}
            wallet={wallet}
            walletStatus={walletStatus}
            usable={usable && portfolio.status !== 'error'}
            now={now}
            onReview={onReview}
          />
        </div>
      ))}
    </>
  );
}

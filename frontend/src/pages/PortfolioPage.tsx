import { Link, NavLink, useSearchParams } from 'react-router';
import { useClient } from '@solana/react';
import { formatUnits, type Deployment } from '../lib/api/client';
import type { AppClient } from '../lib/chain/client';
import { usePortfolio } from '../features/usePortfolio';
import { useChainTime } from '../features/useChainTime';
import { AgreementList } from '../features/AgreementList';
import { ActivityList } from '../features/activity/ActivityList';
import { inFlight, portfolioOperations } from '../features/activity/model';
import type { useActivity } from '../features/activity/useActivity';
import styles from '../App.module.css';

export function PortfolioPage({
  deployment,
  owner,
  written = false,
  history = false,
  activity,
}: {
  deployment: Deployment;
  owner?: string;
  written?: boolean;
  history?: boolean;
  activity: ReturnType<typeof useActivity>;
}) {
  const [search] = useSearchParams();
  const client = useClient<AppClient>();
  const now = useChainTime(client);
  const portfolio = usePortfolio(deployment, owner, undefined, search.get('after') ?? undefined, {
    mode: written ? 'writer' : 'holder',
  });
  const capital = portfolio.data?.agreements
    .filter((item) => item.status === 'funded' || item.status === 'active')
    .reduce((sum, item) => sum + BigInt(item.reserveAmount), 0n);
  const operations = [
    ...new Map(
      [...activity.pending, ...activity.items].map((item) => [item.signature ?? item.id, item]),
    ).values(),
  ].sort((a, b) => b.createdAt - a.createdAt);
  const pending = portfolioOperations(
    operations,
    portfolio.data?.agreements.map((item) => item.address) ?? [],
    written,
    !search.has('after'),
  );
  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>YOUR WALLET'S ACTIVITY</p>
          <h1>My portfolio</h1>
          <p>
            Follow your protection, manage the offers you fund, and review completed agreements.
          </p>
        </div>
        <Link className={styles.primaryButton} to="/offers/new">
          Create offer <span>＋</span>
        </Link>
      </div>
      <nav className={styles.tabs} aria-label="Portfolio views">
        <NavLink end to="/portfolio">
          My protection
        </NavLink>
        <NavLink to="/portfolio/written">My offers</NavLink>
        <NavLink to="/portfolio/activity">Activity</NavLink>
      </nav>
      {!owner ? (
        <div className={styles.emptyState}>
          <span aria-hidden="true">◇</span>
          <h2>Your portfolio starts with your wallet</h2>
          <p>
            Connect to see agreements belonging to your address. Public offers are available to
            browse without connecting.
          </p>
          <a className={styles.outlineButton} href="#wallet">
            Connect wallet
          </a>
        </div>
      ) : (
        <>
          {activity.storageError && (
            <div className={styles.error} role="alert">
              {activity.storageError}
              <button onClick={() => activity.refresh()}>Refresh activity</button>
            </div>
          )}
          {history ? (
            <>
              <p className={styles.note}>
                Signed operations are saved to your wallet’s history. Unsigned attempts stay in this
                browser. An operation’s result is separate from its agreement’s current status.
              </p>
              {!activity.ready && activity.status !== 'error' && (
                <p role="status">Loading activity…</p>
              )}
              {activity.ready && !activity.items.length && (
                <div className={styles.emptyState}>
                  <h2>No operations yet</h2>
                  <p>
                    Actions you confirm will appear here, including pending and unsuccessful
                    attempts.
                  </p>
                </div>
              )}
              <ActivityList items={activity.items} deployment={deployment} />
              <nav className={styles.agreementPages} aria-label="Activity pages">
                {search.has('before') && <Link to="/portfolio/activity">Latest activity</Link>}
                {activity.next && (
                  <Link to={`/portfolio/activity?before=${activity.next}`}>Older activity →</Link>
                )}
              </nav>
            </>
          ) : (
            <>
              <div className={styles.listHeading}>
                <h2>{written ? 'Offers you created' : 'Protection you purchased'}</h2>
                <Link to={written ? '/offers/new' : '/offers'}>
                  {written ? 'Create an offer ↗' : 'Find protection ↗'}
                </Link>
              </div>
              <ActivityList
                items={pending}
                deployment={deployment}
                title={pending.every(inFlight) ? 'Operations in progress' : 'Recent operations'}
              />
              {written && capital !== undefined && (
                <p className={styles.note}>
                  Reserved in your funded and active agreements on this page:{' '}
                  <strong>{formatUnits(capital.toString())} USDC</strong>.
                </p>
              )}
              <AgreementList
                assets={deployment.assets}
                portfolio={portfolio}
                owner={owner}
                now={now}
                emptyTitle={written ? 'No offers created yet' : 'No protection purchased yet'}
                hideEmpty={pending.length > 0}
                emptyDescription={
                  written
                    ? 'Create an offer, set your terms and reserve its full USDC payout. Your offers will appear here.'
                    : 'Accept a funded offer to add protection. Your active and completed agreements will appear here.'
                }
              />
            </>
          )}
        </>
      )}
    </>
  );
}

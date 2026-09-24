import { Link, NavLink, useSearchParams } from 'react-router';
import type { Deployment } from '../lib/api/client';
import { PortfolioAgreements, type PortfolioRole } from '../features/PortfolioAgreements';
import { ActivityList } from '../features/activity/ActivityList';
import type { useActivity } from '../features/activity/useActivity';
import styles from '../App.module.css';

export function PortfolioPage({
  deployment,
  owner,
  view = 'all',
  activity,
}: {
  deployment: Deployment;
  owner?: string;
  view?: PortfolioRole | 'activity';
  activity: ReturnType<typeof useActivity>;
}) {
  const [search] = useSearchParams();
  const roleSearch = search.has('status')
    ? `?${new URLSearchParams({ status: search.get('status')! })}`
    : '';
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
        <NavLink end to={`/portfolio${roleSearch}`}>
          All
        </NavLink>
        <NavLink to={`/portfolio/protection${roleSearch}`}>My protection</NavLink>
        <NavLink to={`/portfolio/written${roleSearch}`}>My offers</NavLink>
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
          {view === 'activity' ? (
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
            <PortfolioAgreements
              deployment={deployment}
              owner={owner}
              role={view}
              activity={activity}
            />
          )}
        </>
      )}
    </>
  );
}

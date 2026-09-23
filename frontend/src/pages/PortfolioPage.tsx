import { Link, NavLink, useSearchParams } from 'react-router';
import { useClient } from '@solana/react';
import { formatUnits, type Deployment } from '../lib/api/client';
import type { AppClient } from '../lib/chain/client';
import { usePortfolio } from '../features/usePortfolio';
import { useChainTime } from '../features/useChainTime';
import { AgreementList } from '../features/AgreementList';
import styles from '../App.module.css';

export function PortfolioPage({
  deployment,
  owner,
  written = false,
}: {
  deployment: Deployment;
  owner?: string;
  written?: boolean;
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
          <div className={styles.listHeading}>
            <h2>{written ? 'Offers you created' : 'Protection you purchased'}</h2>
            <Link to={written ? '/offers/new' : '/offers'}>
              {written ? 'Create an offer ↗' : 'Find protection ↗'}
            </Link>
          </div>
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
            emptyDescription={
              written
                ? 'Create an offer, set your terms and reserve its full USDC payout. Your offers will appear here.'
                : 'Accept a funded offer to add protection. Your active and completed agreements will appear here.'
            }
          />
        </>
      )}
    </>
  );
}

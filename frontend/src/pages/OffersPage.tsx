import { Link, useNavigate, useSearchParams } from 'react-router';
import { useClient } from '@solana/react';
import type { Deployment } from '../lib/api/client';
import type { AppClient } from '../lib/chain/client';
import { usePortfolio, type PortfolioQuery } from '../features/usePortfolio';
import { useChainTime } from '../features/useChainTime';
import { OfferFilters } from '../features/OfferFilters';
import { AgreementList } from '../features/AgreementList';
import styles from '../App.module.css';

export function OffersPage({
  deployment,
  owner,
  filters,
  onFilters,
}: {
  deployment: Deployment;
  owner?: string;
  filters: PortfolioQuery;
  onFilters: (value: PortfolioQuery) => void;
}) {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const client = useClient<AppClient>();
  const now = useChainTime(client);
  const portfolio = usePortfolio(
    deployment,
    owner,
    undefined,
    search.get('after') ?? undefined,
    filters,
  );
  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>THE OFFER MARKET</p>
          <h1>Explore offers</h1>
          <p>
            Compare funded exit rights. Choose the terms that fit the tokens you want to protect.
          </p>
        </div>
        <Link className={styles.primaryButton} to="/offers/new">
          Create offer <span>＋</span>
        </Link>
      </div>
      <OfferFilters
        assets={deployment.assets}
        value={filters}
        onChange={(value) => {
          onFilters(value);
          void navigate('/offers');
        }}
      />
      <div className={styles.listHeading}>
        <h2>Available offers</h2>
        <span>Fully funded · Fixed terms</span>
      </div>
      <AgreementList
        assets={deployment.assets}
        portfolio={portfolio}
        owner={owner}
        now={now}
        emptyTitle="No matching offers"
        emptyDescription="No funded offers match these terms. Try changing the filters."
      />
    </>
  );
}

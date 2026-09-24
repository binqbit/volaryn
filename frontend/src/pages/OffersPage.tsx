import { Link, useSearchParams } from 'react-router';
import { useClient } from '@solana/react';
import { amount, type Asset, type Deployment } from '../lib/api/client';
import type { AppClient } from '../lib/chain/client';
import { usePortfolio, type PortfolioQuery } from '../features/usePortfolio';
import { useChainTime } from '../features/useChainTime';
import { OfferFilters } from '../features/OfferFilters';
import { AgreementList } from '../features/AgreementList';
import styles from '../App.module.css';

const amountFilters = {
  quantityRaw: 'quantity_raw',
  minPayout: 'min_payout',
  maxPremium: 'max_premium',
} as const;

function readFilters(search: URLSearchParams, assets: Asset[]): PortfolioQuery {
  const filters: PortfolioQuery = { mode: 'offers' };
  const side = search.get('side');
  if (side !== null) {
    if (side !== 'holder' && side !== 'writer') throw new Error('Unknown offer side.');
    filters.side = side;
  }
  const mint = search.get('mint');
  if (mint) {
    if (!assets.some((asset) => asset.mint === mint))
      throw new Error('This token is not available on the connected deployment.');
    filters.mint = mint;
  }
  for (const [field, parameter] of Object.entries(amountFilters)) {
    const value = search.get(parameter);
    if (value !== null) {
      amount(value);
      filters[field as keyof typeof amountFilters] = value;
    }
  }
  if (filters.quantityRaw !== undefined && !filters.mint)
    throw new Error('An exact quantity requires a selected PreStocks token.');
  return filters;
}

export function OffersPage({ deployment, owner }: { deployment: Deployment; owner?: string }) {
  const [search, setSearch] = useSearchParams();
  let filters: PortfolioQuery = { mode: 'offers' };
  let error: string | undefined;
  try {
    filters = readFilters(search, deployment.assets);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : 'Invalid offer filters.';
  }
  return (
    <>
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>THE OFFER MARKET</p>
          <h1>Explore offers</h1>
          <p>
            Match protection requests with capital offers. Each offer has a fixed quantity, premium,
            payout and deadline.
          </p>
        </div>
        <Link className={styles.primaryButton} to="/offers/new">
          Create offer <span>＋</span>
        </Link>
      </div>
      <nav className={styles.tabs} aria-label="Offer sides">
        {(
          [
            { side: undefined, label: 'All offers' },
            { side: 'holder', label: 'Sell requests' },
            { side: 'writer', label: 'Buy offers' },
          ] as const
        ).map((item) => {
          const params = new URLSearchParams(search);
          params.delete('after');
          if (item.side) params.set('side', item.side);
          else params.delete('side');
          return (
            <Link
              key={item.label}
              aria-current={filters.side === item.side ? 'page' : undefined}
              to={`/offers${params.size ? `?${params}` : ''}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <OfferFilters
        assets={deployment.assets}
        value={filters}
        onChange={(value) => {
          const next = new URLSearchParams();
          if (value.side) next.set('side', value.side);
          if (value.mint) next.set('mint', value.mint);
          for (const [field, parameter] of Object.entries(amountFilters)) {
            const amount = value[field as keyof typeof amountFilters];
            if (amount !== undefined) next.set(parameter, amount);
          }
          void setSearch(next);
        }}
      />
      {error ? (
        <p className={styles.error} role="alert">
          {error} <Link to="/offers">Clear invalid filters</Link>
        </p>
      ) : (
        <OfferResults deployment={deployment} owner={owner} filters={filters} />
      )}
    </>
  );
}

function OfferResults({
  deployment,
  owner,
  filters,
}: {
  deployment: Deployment;
  owner?: string;
  filters: PortfolioQuery;
}) {
  const [search] = useSearchParams();
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
      <div className={styles.listHeading}>
        <h2>Available offers</h2>
        <span>Fixed terms · Escrowed deposits</span>
      </div>
      {owner && (
        <p className={styles.note}>
          Your own offers are in <Link to="/portfolio">My portfolio</Link>. You cannot accept them
          yourself.
        </p>
      )}
      <AgreementList
        assets={deployment.assets}
        portfolio={portfolio}
        owner={owner}
        now={now}
        emptyTitle="No matching offers"
        emptyDescription="No offers match these terms. Try changing the filters."
      />
    </>
  );
}

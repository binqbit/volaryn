import { Link, useSearchParams } from 'react-router';
import { useClient } from '@solana/react';
import { formatUnits, type Deployment } from '../lib/api/client';
import type { AppClient } from '../lib/chain/client';
import { usePortfolio, type PortfolioQuery } from './usePortfolio';
import { useChainTime } from './useChainTime';
import { AgreementList } from './AgreementList';
import { ActivityList } from './activity/ActivityList';
import { inFlight, portfolioOperations } from './activity/model';
import type { useActivity } from './activity/useActivity';
import styles from '../App.module.css';

export type PortfolioRole = 'all' | 'holder' | 'writer';
const lifecycleLabels = {
  available: 'Available',
  acceptance_ended: 'Acceptance ended',
  active: 'Active',
  exercised: 'Exercised',
  cancelled: 'Cancelled',
  expired: 'Expired',
} satisfies Record<NonNullable<PortfolioQuery['lifecycle']>, string>;

export function PortfolioAgreements({
  deployment,
  owner,
  role,
  activity,
}: {
  deployment: Deployment;
  owner: string;
  role: PortfolioRole;
  activity: ReturnType<typeof useActivity>;
}) {
  const [search, setSearch] = useSearchParams();
  const status = search.get('status') ?? '';
  const valid = status === '' || Object.hasOwn(lifecycleLabels, status);
  return (
    <>
      <div className={styles.listHeading}>
        <h2>
          {role === 'all'
            ? 'All your agreements'
            : role === 'writer'
              ? 'Your capital commitments'
              : 'Your protection and requests'}
        </h2>
        <label className={styles.field}>
          <span>Agreement status</span>
          <select
            value={valid ? status : 'invalid'}
            onChange={(event) => {
              const next = new URLSearchParams();
              if (event.target.value) next.set('status', event.target.value);
              void setSearch(next);
            }}
          >
            <option value="">All statuses</option>
            {!valid && (
              <option value="invalid" disabled>
                Unknown status
              </option>
            )}
            {Object.entries(lifecycleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {valid ? (
        <PortfolioResults
          deployment={deployment}
          owner={owner}
          role={role}
          activity={activity}
          lifecycle={status ? (status as PortfolioQuery['lifecycle']) : undefined}
        />
      ) : (
        <p className={styles.error} role="alert">
          Unknown agreement status. <Link to="?">Clear status filter</Link>
        </p>
      )}
    </>
  );
}

function PortfolioResults({
  deployment,
  owner,
  role,
  activity,
  lifecycle,
}: {
  deployment: Deployment;
  owner: string;
  role: PortfolioRole;
  activity: ReturnType<typeof useActivity>;
  lifecycle?: PortfolioQuery['lifecycle'];
}) {
  const [search] = useSearchParams();
  const client = useClient<AppClient>();
  const now = useChainTime(client);
  const portfolio = usePortfolio(deployment, owner, undefined, search.get('after') ?? undefined, {
    mode: role,
    lifecycle,
  });
  const operations = [
    ...new Map(
      [...activity.pending, ...activity.items]
        .filter((item) => item.owner === owner)
        .map((item) => [item.signature ?? item.id, item]),
    ).values(),
  ].sort((a, b) => b.createdAt - a.createdAt);
  const pending = portfolioOperations(
    operations,
    [
      ...activity.indexedAgreements,
      ...(portfolio.data?.agreements.map((item) => item.address) ?? []),
    ],
    role,
    activity.awaitingDiscovery,
  );
  const capital = portfolio.data?.agreements
    .filter((item) => item.writer === owner && (item.status === 'open' || item.status === 'active'))
    .reduce((sum, item) => sum + BigInt(item.reserveAmount), 0n);
  const premiums = portfolio.data?.agreements
    .filter((item) => item.creator === owner && item.side === 'holder' && item.status === 'open')
    .reduce((sum, item) => sum + BigInt(item.reserveAmount), 0n);
  return (
    <>
      <ActivityList
        items={pending}
        deployment={deployment}
        title={pending.every(inFlight) ? 'Operations in progress' : 'Recent operations'}
      />
      {lifecycle && pending.length > 0 && (
        <p className={styles.note}>
          Recent operations awaiting confirmation or discovery are shown separately from the
          agreement status filter.
        </p>
      )}
      {role !== 'holder' && capital !== undefined && capital > 0n && (
        <p className={styles.note}>
          Payout reserved in your open and active capital commitments on this page:{' '}
          <strong>{formatUnits(capital.toString())} USDC</strong>.
        </p>
      )}
      {role !== 'writer' && premiums !== undefined && premiums > 0n && (
        <p className={styles.note}>
          Premium escrowed in your unaccepted requests on this page:{' '}
          <strong>{formatUnits(premiums.toString())} USDC</strong>.
        </p>
      )}
      <AgreementList
        assets={deployment.assets}
        portfolio={portfolio}
        owner={owner}
        now={now}
        emptyTitle={
          lifecycle
            ? 'No agreements match this status'
            : role === 'all'
              ? 'No agreements yet'
              : role === 'writer'
                ? 'No capital commitments yet'
                : 'No protection or requests yet'
        }
        hideEmpty={!lifecycle && pending.length > 0}
        emptyDescription={
          lifecycle
            ? 'Choose another status or All statuses to see your other agreements.'
            : 'Your requests, protection and capital commitments stay in your portfolio throughout their lifecycle.'
        }
      />
    </>
  );
}

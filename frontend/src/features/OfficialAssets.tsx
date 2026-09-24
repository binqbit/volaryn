import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useRequest } from '@solana/react';
import { api } from '../lib/api/client';
import { observationStatus } from '../lib/api/observation';
import { OfficialAssetCard } from './OfficialAssetCard';
import { Details } from './Details';
import layout from '../App.module.css';
import styles from './OfficialAssets.module.css';

function timestamp(value: number | null | undefined) {
  return value == null ? 'Unavailable' : new Date(value * 1000).toISOString().replace('T', ' ');
}

export function OfficialAssets() {
  const [search, setSearch] = useSearchParams();
  const query = search.get('q') ?? '';
  const source = useCallback(async (signal: AbortSignal) => {
    const response = await api.GET('/api/assets/official', { signal });
    if (!response.data) throw new Error('Official asset observations are unavailable');
    return response.data;
  }, []);
  const request = useRequest(source, { getAbortSignal: () => AbortSignal.timeout(12000) });
  const { refresh } = request;
  const status = observationStatus(request);
  useEffect(() => {
    if (request.status === 'fetching') return;
    const timer = setTimeout(refresh, 30000);
    return () => clearTimeout(timer);
  }, [refresh, request.status]);
  const assets = request.data?.assets.filter((asset) =>
    [asset.name, asset.symbol, asset.mint].some((value) =>
      value.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );
  return (
    <section className={styles.catalog} aria-labelledby="official-assets-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>PRESTOCKS · SOLANA MAINNET · READ ONLY</p>
          <h1 id="official-assets-title">Official assets</h1>
        </div>
        <button
          className={layout.outlineButton}
          onClick={() => {
            if (request.status !== 'fetching') refresh();
          }}
          disabled={status === 'fetching'}
          aria-busy={request.status === 'fetching'}
        >
          Refresh issuer context
        </button>
      </div>
      <p>
        Explore issuer information and verified mint behavior.{' '}
        {import.meta.env.MODE === 'localnet' &&
          'These mainnet assets are separate from your local test wallet. '}
        This view cannot create offers or request a signature.
      </p>
      <p>Source prices are informational; they do not set agreement payouts.</p>
      <label className={layout.field}>
        <span>Search official PreStocks</span>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            void setSearch(value ? { q: value } : {}, { replace: true });
          }}
          placeholder="Name, ticker or mainnet mint"
        />
      </label>
      {status === 'fetching' && <p role="status">Loading official sources…</p>}
      {status === 'error' && (
        <p role="alert">
          Official sources could not be refreshed. Any retained values are last known observations.
          Agreement actions are separate from this catalogue.
        </p>
      )}
      {request.data && (
        <>
          <Details
            title="Data sources & methodology"
            hint={`Issuer ${status === 'error' ? 'stale' : request.data.marketSource.status} · Chain ${status === 'error' ? 'stale' : request.data.chainSource.status}`}
          >
            <p>
              The source does not identify when prices were observed or how they relate to display
              units, so derived position values and protection percentages are unavailable.
            </p>
            <dl className={styles.sources}>
              <div>
                <dt>Issuer API</dt>
                <dd>
                  {status === 'error' ? 'stale' : request.data.marketSource.status} · received{' '}
                  {timestamp(request.data.marketSource.receivedAt)}
                </dd>
              </div>
              <div>
                <dt>Mainnet verification</dt>
                <dd>
                  {status === 'error' ? 'stale' : request.data.chainSource.status} · received{' '}
                  {timestamp(request.data.chainSource.receivedAt)}
                </dd>
              </div>
              <div>
                <dt>Finalized mint slot</dt>
                <dd>{request.data.finalizedSlot ?? 'Unavailable'}</dd>
              </div>
            </dl>
            <p>
              <a href={request.data.source} target="_blank" rel="noreferrer">
                Official data source ↗
              </a>{' '}
              · Network genesis: <code>{request.data.genesisHash}</code>
            </p>
          </Details>
          {(request.data.marketSource.error || request.data.chainSource.error) && (
            <p role="status">
              A source is unavailable. Retained observations cannot authorize new admission.
            </p>
          )}
          {assets?.length === 0 && <p role="status">No official PreStocks match this search.</p>}
          <div className={styles.grid}>
            {assets?.map((asset) => (
              <OfficialAssetCard key={asset.mint} asset={asset} unavailable={status === 'error'} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

import { useCallback, useEffect } from 'react';
import { useRequest } from '@solana/react';
import { api, amount, type Deployment } from '../lib/api/client';
import { observationStatus } from '../lib/api/observation';

export interface PortfolioQuery {
  mode: 'all' | 'offers' | 'writer' | 'holder';
  mint?: string;
  quantityRaw?: string;
  minPayout?: string;
  maxPremium?: string;
}

export function usePortfolio(
  deployment: Deployment,
  owner: string | undefined,
  selected?: string,
  after?: string,
  query: PortfolioQuery = { mode: 'all' },
) {
  const { mode, mint, quantityRaw, minPayout, maxPremium } = query;
  const identity = JSON.stringify([
    deployment.genesisHash,
    owner,
    selected,
    after,
    mode,
    mint,
    quantityRaw,
    minPayout,
    maxPremium,
  ]);
  const source = useCallback(
    async (signal: AbortSignal) => {
      const params = {
        after,
        mint,
        writer: mode === 'writer' ? owner : undefined,
        holder: mode === 'holder' ? owner : undefined,
        eligible_holder: mode === 'offers' ? owner : undefined,
        quantity_raw: quantityRaw,
        min_payout: minPayout,
        max_premium: maxPremium,
      };
      if ((mode === 'writer' || mode === 'holder') && !owner && !selected)
        return { identity, agreements: [], next: null };
      const result = selected
        ? await api.GET('/api/agreements/{address}', {
            params: { path: { address: selected } },
            signal,
          })
        : mode === 'offers'
          ? await api.GET('/api/offers', { params: { query: params }, signal })
          : await api.GET('/api/agreements', { params: { query: params }, signal });
      // A submitted creation may not exist at the finalized commitment yet.
      // Missing account data is distinct from a failed RPC or API request.
      if (selected && result.response.status === 404)
        return { identity, agreements: [], next: null };
      if (!result.data)
        throw new Error('Agreement lookup is unavailable. This does not mean no offers exist.');
      const observed = Array.isArray(result.data) ? result.data : [result.data];
      const agreements =
        mode === 'offers' && owner && !selected
          ? observed.filter((agreement) => agreement.writer !== owner)
          : observed;
      for (const value of agreements) {
        if (value.version !== 1) throw new Error('An agreement version is unsupported');
        for (const raw of [
          value.quantityRaw,
          value.payout,
          value.premium,
          value.reserveAmount,
          value.acceptBefore,
          value.expiresAt,
        ])
          amount(raw);
      }
      return { identity, agreements, next: result.response.headers.get('X-Next-Cursor') };
    },
    [mint, owner, selected, after, mode, quantityRaw, minPayout, maxPremium, identity],
  );
  const request = useRequest(source, { getAbortSignal: () => AbortSignal.timeout(8000) });
  const { refresh, status } = request;
  useEffect(() => {
    if (status === 'fetching') return;
    const timer = setTimeout(refresh, 3000);
    return () => clearTimeout(timer);
  }, [refresh, status]);
  const data = request.data?.identity === identity ? request.data : undefined;
  return { ...request, data, status: observationStatus({ ...request, data }) };
}

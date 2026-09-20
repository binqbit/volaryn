import { useCallback, useEffect } from 'react';
import { useRequest } from '@solana/react';
import { api, amount, type Deployment } from '../lib/api/client';

export function usePortfolio(
  deployment: Deployment,
  owner: string | undefined,
  selected?: string,
  after?: string,
) {
  const source = useCallback(
    async (signal: AbortSignal) => {
      const [result, positions] = await Promise.all([
        selected
          ? api.GET('/api/agreements/{address}', {
              params: { path: { address: selected } },
              signal,
            })
          : api.GET('/api/agreements', { params: { query: { after } }, signal }),
        owner ? api.GET('/api/positions', { params: { query: { owner } }, signal }) : null,
      ]);
      if (!result.data) throw new Error('Agreement data is unavailable. Refresh before signing.');
      const agreements = Array.isArray(result.data) ? result.data : [result.data];
      for (const value of agreements) {
        if (value.version !== 1) throw new Error('An agreement version is unsupported');
        amount(value.quantityRaw);
        amount(value.payout);
        amount(value.premium);
        amount(value.reserveAmount);
      }
      if (owner && !positions?.data) throw new Error('Position data is unavailable.');
      return {
        owner,
        selected,
        after,
        genesis: deployment.genesisHash,
        agreements,
        next: result.response.headers.get('X-Next-Cursor'),
        positions: positions?.data ?? [],
      };
    },
    [deployment.genesisHash, owner, selected, after],
  );
  const request = useRequest(source, { getAbortSignal: () => AbortSignal.timeout(8000) });
  const { refresh, status } = request;
  useEffect(() => {
    if (status === 'fetching') return;
    const timer = window.setTimeout(() => refresh(), 3000);
    return () => window.clearTimeout(timer);
  }, [refresh, status]);
  const data =
    request.data &&
    request.data.owner === owner &&
    request.data.genesis === deployment.genesisHash &&
    request.data.selected === selected &&
    request.data.after === after
      ? request.data
      : undefined;
  return { ...request, data };
}

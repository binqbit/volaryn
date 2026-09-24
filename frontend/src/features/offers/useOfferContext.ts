import { useCallback, useEffect } from 'react';
import { useClient, useRequest } from '@solana/react';
import type { Asset, Deployment } from '../../lib/api/client';
import { observationStatus } from '../../lib/api/observation';
import type { AppClient } from '../../lib/chain/client';
import { loadOfferContext } from '../../lib/chain/offerContext';

export function useOfferContext(deployment: Deployment, asset: Asset | undefined) {
  const client = useClient<AppClient>();
  const source = useCallback(
    async (signal: AbortSignal) => {
      if (!asset) return undefined;
      return loadOfferContext(client, deployment, asset, signal);
    },
    [client, deployment, asset],
  );
  const request = useRequest(asset ? source : null, {
    getAbortSignal: () => AbortSignal.timeout(8000),
  });
  const { refresh, status } = request;
  useEffect(() => {
    if (!asset || status === 'fetching') return;
    const timer = setTimeout(refresh, 30_000);
    return () => clearTimeout(timer);
  }, [asset, refresh, status]);

  // A failed refresh must not keep offering terms based on a previously valid policy.
  const data =
    status !== 'error' && request.error === undefined && request.data?.mint === asset?.mint
      ? request.data
      : undefined;
  return { ...request, data, status: observationStatus({ ...request, data }) };
}

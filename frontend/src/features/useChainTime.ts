import { useCallback, useEffect } from 'react';
import { useRequest } from '@solana/react';
import { chainTime } from '../lib/chain/buildAction';
import type { AppClient } from '../lib/chain/client';

export function useChainTime(client: AppClient) {
  const source = useCallback(() => chainTime(client), [client]);
  const request = useRequest(source);
  const { refresh, status } = request;
  useEffect(() => {
    if (status === 'fetching') return;
    const timer = setTimeout(refresh, 3000);
    return () => clearTimeout(timer);
  }, [refresh, status]);
  return request.status === 'error' ? undefined : request.data;
}

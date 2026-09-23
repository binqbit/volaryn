import { useCallback, useEffect } from 'react';
import { useRequest } from '@solana/react';
import { address } from '@solana/kit';
import { api, amount } from '../lib/api/client';
import { observationStatus } from '../lib/api/observation';

export function useWallet(owner: string | undefined) {
  const source = useCallback(
    async (signal: AbortSignal) => {
      if (!owner) return undefined;
      const result = await api.GET('/api/wallet', { params: { query: { owner } }, signal });
      if (!result.data || result.data.owner !== owner)
        throw new Error('Wallet data is unavailable');
      for (const account of result.data.accounts) {
        address(account.address);
        address(account.mint);
        address(account.tokenProgram);
        amount(account.amountRaw);
        amount(account.finalizedSlot);
      }
      return result.data;
    },
    [owner],
  );
  const request = useRequest(source, { getAbortSignal: () => AbortSignal.timeout(8000) });
  const { refresh, status } = request;
  useEffect(() => {
    if (!owner || status === 'fetching') return;
    const timer = setTimeout(refresh, 3000);
    return () => clearTimeout(timer);
  }, [owner, refresh, status]);
  const data = request.data?.owner === owner ? request.data : undefined;
  return { ...request, data, status: observationStatus({ ...request, data }) };
}

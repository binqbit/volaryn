import type { RequestResult } from '@solana/react';

/** Keep the last observation visible during a refresh, including errors until recovery. */
export function observationStatus({
  data,
  error,
  status,
}: Pick<RequestResult<unknown>, 'data' | 'error' | 'status'>): RequestResult<unknown>['status'] {
  if (status !== 'fetching') return status;
  if (error !== undefined) return 'error';
  return data === undefined ? 'fetching' : 'success';
}

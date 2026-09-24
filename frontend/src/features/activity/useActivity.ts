import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRequest } from '@solana/react';
import { api } from '../../lib/api/client';
import { observationStatus } from '../../lib/api/observation';
import { activityChanged, activityKey, readActivity } from './storage';
import { discoveryAttempts, mergeActivity, type ActivityItem } from './model';

export function useActivity(key: string, owner: string | undefined, before?: string) {
  const [, setRevision] = useState(0);
  const [discovery, setDiscovery] = useState<{ key: string; attempts: string[] }>({
    key,
    attempts: [],
  });
  const identity = `${key}:${before ?? ''}`;
  const source = useCallback(
    async (signal: AbortSignal) => {
      if (!owner) return { identity, items: [], pending: [], indexedAgreements: [], next: null };
      const result = await api.GET('/api/activity', {
        params: { query: { owner, before } },
        signal,
      });
      if (!result.data) throw new Error('Activity could not be refreshed');
      const convert = (item: (typeof result.data.items)[number]): ActivityItem => ({
        ...item,
        createdTerms: item.createdTerms
          ? { ...item.createdTerms, designatedHolder: item.createdTerms.designatedHolder ?? null }
          : undefined,
        source: 'server',
        createdAt: item.createdAt * 1000,
        updatedAt: item.updatedAt * 1000,
      });
      return {
        identity,
        items: result.data.items.map(convert),
        pending: result.data.pending.map(convert),
        indexedAgreements: result.data.indexedAgreements,
        next: result.data.next,
      };
    },
    [identity, owner, before],
  );
  const request = useRequest(source, { getAbortSignal: () => AbortSignal.timeout(8000) });
  const { status, refresh } = request;
  useEffect(() => {
    if (status === 'fetching') return;
    const timer = setTimeout(refresh, 3000);
    return () => clearTimeout(timer);
  }, [status, refresh]);
  useEffect(() => {
    const changed = (event: Event) => {
      if (!(event instanceof StorageEvent) || event.key === activityKey(key) || event.key === null)
        setRevision((value) => value + 1);
    };
    window.addEventListener(activityChanged, changed);
    window.addEventListener('storage', changed);
    return () => {
      window.removeEventListener(activityChanged, changed);
      window.removeEventListener('storage', changed);
    };
  }, [key]);
  const data = request.data?.identity === identity ? request.data : undefined;
  let local: ActivityItem[] = [];
  let storageError = '';
  try {
    if (owner) local = readActivity(key, owner);
  } catch {
    storageError =
      'This browser’s activity could not be read. Signed operations are still available from the server.';
  }
  // Read on every notified render, without treating localStorage as authoritative chain state.
  const items = mergeActivity(before ? [] : local, data?.items ?? []);
  const pending = mergeActivity(local, data?.pending ?? []);
  const indexedAgreements = useMemo(() => data?.indexedAgreements ?? [], [data]);
  useEffect(() => {
    setDiscovery((current) => {
      const attempts = discoveryAttempts(
        current.key === key ? current.attempts : [],
        [...items, ...pending],
        indexedAgreements,
      );
      return current.key === key && JSON.stringify(current.attempts) === JSON.stringify(attempts)
        ? current
        : { key, attempts };
    });
  }, [key, items, pending, indexedAgreements]);
  return {
    items,
    pending,
    indexedAgreements,
    awaitingDiscovery: discovery.key === key ? discovery.attempts : [],
    next: data?.next,
    refresh,
    storageError,
    status: observationStatus({ ...request, data }),
    ready: !!data,
  };
}

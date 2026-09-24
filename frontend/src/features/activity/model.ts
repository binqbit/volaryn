import type { Operation, OfferTerms, OfferSide } from '../../lib/chain/actionTypes';
import type { PendingTransaction } from '../pending';

export const attemptStatuses = [
  'preparing',
  'awaiting-signature',
  'interrupted',
  'not-submitted',
  'pending',
  'provisional',
  'finalized',
  'failed',
  'expired',
  'reconciled',
  'unresolved',
] as const;
export type AttemptStatus = (typeof attemptStatuses)[number];
export interface ActivityItem {
  side: OfferSide;
  actorRole: OfferSide;
  id: string;
  owner: string;
  agreement: string;
  operation: Operation;
  createdTerms?: OfferTerms;
  signature?: string;
  lastValidBlockHeight?: string;
  createdAt: number;
  updatedAt: number;
  status: AttemptStatus;
  error?: string;
  source: 'browser' | 'server';
}

export function inFlight(item: ActivityItem) {
  return ['preparing', 'awaiting-signature', 'pending', 'provisional', 'unresolved'].includes(
    item.status,
  );
}

export function asPending(item: ActivityItem): PendingTransaction | null {
  if (!item.signature || !item.lastValidBlockHeight || !inFlight(item)) return null;
  return {
    side: item.side,
    actorRole: item.actorRole,
    signature: item.signature,
    lastValidBlockHeight: item.lastValidBlockHeight,
    owner: item.owner,
    agreement: item.agreement,
    operation: item.operation,
    ...(item.createdTerms ? { createdTerms: item.createdTerms } : {}),
  };
}

export const statusLabels: Record<AttemptStatus, string> = {
  preparing: 'Preparing transaction',
  'awaiting-signature': 'Waiting for wallet approval',
  interrupted: 'Signing interrupted · not submitted',
  'not-submitted': 'Not submitted',
  pending: 'Awaiting confirmation',
  provisional: 'Confirmed · awaiting finality',
  finalized: 'Finalized',
  failed: 'Failed on chain',
  expired: 'Expired · action not completed',
  reconciled: 'Action verified',
  unresolved: 'Outcome unknown · checking',
};

export function mergeActivity(local: ActivityItem[], remote: ActivityItem[]) {
  const bySignature = new Map(remote.map((item) => [item.signature, item]));
  const merged = local.map((item) => {
    const server = item.signature ? bySignature.get(item.signature) : undefined;
    if (!server) return item;
    bySignature.delete(item.signature);
    // The server may be one observation behind the browser. Do not regress a proven outcome.
    return {
      ...server,
      createdAt: Math.min(item.createdAt, server.createdAt),
      ...(!inFlight(item) && inFlight(server) ? { status: item.status } : {}),
    };
  });
  return [...merged, ...bySignature.values()].sort(
    (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
  );
}

export function portfolioOperations(
  items: ActivityItem[],
  indexed: string[],
  role: 'all' | 'writer' | 'holder',
  awaitingDiscovery: string[] = [],
) {
  const relevant = items.filter((item) => role === 'all' || item.actorRole === role);
  // Discovery presence comes from the activity API, independent of portfolio pages/filters.
  // Include server receipts and attempts observed in flight, without reviving old local history.
  return relevant.filter(
    (item) =>
      inFlight(item) ||
      ((item.source === 'server' || awaitingDiscovery.includes(item.signature ?? item.id)) &&
        ['create', 'activate'].includes(item.operation) &&
        ['finalized', 'reconciled'].includes(item.status) &&
        !indexed.includes(item.agreement)),
  );
}

/** Keep attempts observed in flight until discovery catches up, even before receipt refresh. */
export function discoveryAttempts(previous: string[], items: ActivityItem[], indexed: string[]) {
  return [
    ...new Set(
      items
        .filter(
          (item) =>
            ['create', 'activate'].includes(item.operation) &&
            !indexed.includes(item.agreement) &&
            (inFlight(item) ||
              (previous.includes(item.signature ?? item.id) &&
                ['finalized', 'reconciled'].includes(item.status))),
        )
        .map((item) => item.signature ?? item.id),
    ),
  ].sort();
}

import { address } from '@solana/kit';
import { operations } from '../../lib/chain/actionTypes';
import { parseOfferTerms, parsePending } from '../pending';
import { attemptStatuses, type ActivityItem } from './model';

export const activityChanged = 'volaryn:activity-changed';
export const activityKey = (journal: string) => `${journal}:activity`;

export function readActivity(key: string, owner: string): ActivityItem[] {
  const value: unknown = JSON.parse(localStorage.getItem(activityKey(key)) ?? '[]');
  if (!Array.isArray(value)) throw new Error('Saved activity is invalid');
  return value.map((item: unknown) => parseActivity(item, owner));
}

function parseActivity(item: unknown, owner: string): ActivityItem {
  if (!item || typeof item !== 'object') throw new Error('Saved activity is invalid');
  const entry = item as ActivityItem;
  if (
    typeof entry.id !== 'string' ||
    !['writer', 'holder'].includes(entry.side) ||
    !['writer', 'holder'].includes(entry.actorRole) ||
    entry.owner !== owner ||
    typeof entry.agreement !== 'string' ||
    !operations.includes(entry.operation) ||
    !attemptStatuses.includes(entry.status) ||
    !Number.isSafeInteger(entry.createdAt) ||
    !Number.isSafeInteger(entry.updatedAt) ||
    (entry.error !== undefined && typeof entry.error !== 'string')
  )
    throw new Error('Saved activity is invalid');
  address(entry.owner);
  address(entry.agreement);
  const pending = entry.signature ? parsePending(JSON.stringify(entry)) : undefined;
  if (
    [
      'pending',
      'provisional',
      'finalized',
      'failed',
      'expired',
      'reconciled',
      'unresolved',
    ].includes(entry.status) &&
    !pending
  )
    throw new Error('Saved signed activity is incomplete');
  return {
    side: entry.side,
    actorRole: entry.actorRole,
    id: entry.id,
    owner: entry.owner,
    agreement: entry.agreement,
    operation: entry.operation,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    status: entry.status,
    error: entry.error,
    ...(entry.operation === 'create' ? { createdTerms: parseOfferTerms(entry.createdTerms) } : {}),
    ...(pending ?? {}),
    source: 'browser',
  };
}

export function saveActivity(key: string, item: ActivityItem) {
  item = parseActivity(item, item.owner);
  const entries = readActivity(key, item.owner);
  const index = entries.findIndex(
    (entry) => entry.id === item.id || (!!item.signature && entry.signature === item.signature),
  );
  if (index === -1) entries.push(item);
  else entries[index] = item;
  localStorage.setItem(activityKey(key), JSON.stringify(entries));
  window.dispatchEvent(new Event(activityChanged));
}

export function updateActivity(
  key: string,
  owner: string,
  id: string,
  patch: Partial<ActivityItem>,
) {
  const item = readActivity(key, owner).find((entry) => entry.id === id || entry.signature === id);
  if (item) saveActivity(key, { ...item, ...patch, updatedAt: Date.now() });
}

// Called only while holding the wallet's signing lock: another tab's approval is never cancelled.
export function recoverInterrupted(key: string, owner: string) {
  for (const item of readActivity(key, owner)) {
    if (item.status === 'preparing' || item.status === 'awaiting-signature')
      saveActivity(key, {
        ...item,
        status: 'interrupted',
        updatedAt: Date.now(),
        error: 'The signing session ended before submission. Review the action again to continue.',
      });
  }
}

import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { journalKey } from '../journal';
import { readActivity, saveActivity, recoverInterrupted, updateActivity } from './storage';
import type { ActivityItem } from './model';

const owner = '11111111111111111111111111111111';
const key = journalKey('ledger', 'program', owner);
const item: ActivityItem = {
  side: 'writer' as const,
  actorRole: 'holder' as const,
  id: 'attempt',
  owner,
  agreement: owner,
  operation: 'activate',
  createdAt: 100,
  updatedAt: 100,
  status: 'awaiting-signature',
  source: 'browser',
};
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());
it('recovers interrupted unsigned attempts while preserving signed outcome tracking', () => {
  saveActivity(key, item);
  saveActivity(key, {
    ...item,
    id: 'signed',
    signature: '1'.repeat(64),
    lastValidBlockHeight: '200',
    status: 'pending',
  });
  recoverInterrupted(key, owner);
  expect(readActivity(key, owner).map((entry) => entry.status)).toEqual(['interrupted', 'pending']);
  updateActivity(key, owner, 'signed', { status: 'finalized' });
  expect(readActivity(key, owner)).toHaveLength(2);
  expect(readActivity(key, owner)[1]?.status).toBe('finalized');
});
it('isolates wallets and deployments and never retains private or signed bytes', () => {
  saveActivity(key, { ...item, encoded: 'not-allowed' } as ActivityItem);
  expect(readActivity(key, owner)[0]).not.toHaveProperty('encoded');
  expect(localStorage.getItem(`${key}:activity`)).not.toContain('not-allowed');
  expect(readActivity(journalKey('other', 'program', owner), owner)).toEqual([]);
  expect(() => readActivity(key, 'another')).toThrow('invalid');
});

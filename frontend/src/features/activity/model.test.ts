import { describe, expect, it } from 'vitest';
import {
  asPending,
  inFlight,
  mergeActivity,
  portfolioOperations,
  type ActivityItem,
} from './model';

const item: ActivityItem = {
  id: 'attempt',
  owner: '11111111111111111111111111111111',
  agreement: '11111111111111111111111111111111',
  operation: 'activate',
  status: 'awaiting-signature',
  createdAt: 100,
  updatedAt: 100,
  source: 'browser',
};
const signed: ActivityItem = {
  ...item,
  signature: '1'.repeat(64),
  lastValidBlockHeight: '200',
  status: 'pending',
};
describe('operation lifecycle', () => {
  it('shows unresolved work and only the latest successful creation awaiting discovery', () => {
    const latest = { ...signed, operation: 'create' as const, status: 'finalized' as const };
    const older = { ...latest, id: 'older', agreement: 'older' };
    expect(portfolioOperations([latest, older], [], true, true)).toEqual([latest]);
    expect(portfolioOperations([latest, older], [], true, false)).toEqual([]);
    expect(portfolioOperations([latest], [latest.agreement], true, true)).toEqual([]);
    const cancel = { ...signed, operation: 'cancel' as const };
    expect(portfolioOperations([cancel], [cancel.agreement], true, false)).toEqual([cancel]);
  });
  it('distinguishes unsigned interruption from recoverable signed operations', () => {
    expect(inFlight(item)).toBe(true);
    expect(asPending(item)).toBeNull();
    expect(asPending({ ...item, status: 'interrupted' })).toBeNull();
    expect(asPending(signed)?.signature).toBe(signed.signature);
    for (const status of ['failed', 'expired', 'finalized', 'reconciled'] as const)
      expect(asPending({ ...signed, status })).toBeNull();
  });
  it('deduplicates by signature without merging distinct attempts on one agreement', () => {
    const remote = {
      ...signed,
      id: '42',
      source: 'server' as const,
      status: 'provisional' as const,
    };
    const merged = mergeActivity([item, signed], [remote]);
    expect(merged).toHaveLength(2);
    expect(merged.find((entry) => entry.signature)?.status).toBe('provisional');
  });
  it('does not regress a finalized local result while the server catches up', () => {
    expect(
      mergeActivity([{ ...signed, status: 'finalized' }], [{ ...signed, source: 'server' }])[0]
        ?.status,
    ).toBe('finalized');
    expect(
      mergeActivity([signed], [{ ...signed, source: 'server', status: 'failed' }])[0]?.status,
    ).toBe('failed');
  });
});

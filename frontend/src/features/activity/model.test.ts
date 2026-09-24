import { describe, expect, it } from 'vitest';
import {
  asPending,
  discoveryAttempts,
  inFlight,
  mergeActivity,
  portfolioOperations,
  type ActivityItem,
} from './model';

const item: ActivityItem = {
  side: 'writer' as const,
  actorRole: 'holder' as const,
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
  it('retains a locally observed finalization through receipt lag without reviving old history', () => {
    const awaiting = discoveryAttempts([], [signed], []);
    expect(awaiting).toEqual([signed.signature]);
    const finalized = { ...signed, status: 'finalized' as const };
    expect(discoveryAttempts(awaiting, [finalized], [])).toEqual(awaiting);
    expect(portfolioOperations([finalized], [], 'all', awaiting)).toEqual([finalized]);
    expect(discoveryAttempts([], [finalized], [])).toEqual([]);
    expect(portfolioOperations([finalized], [signed.agreement], 'all', awaiting)).toEqual([]);
    expect(discoveryAttempts(awaiting, [finalized], [signed.agreement])).toEqual([]);
    expect(discoveryAttempts(awaiting, [{ ...signed, status: 'failed' }], [])).toEqual([]);
  });
  it('combines both roles without presenting failed attempts as agreements', () => {
    const creation = {
      ...signed,
      id: 'creation',
      operation: 'create' as const,
      actorRole: 'writer' as const,
      agreement: 'created',
      status: 'finalized' as const,
      source: 'server' as const,
    };
    const activation = {
      ...signed,
      id: 'activation',
      agreement: 'activated',
      status: 'reconciled' as const,
      source: 'server' as const,
    };
    const failed = { ...signed, id: 'failed', status: 'failed' as const };
    const items = [creation, activation, signed, failed];
    expect(portfolioOperations(items, [], 'all')).toEqual([creation, activation, signed]);
    expect(portfolioOperations(items, ['created', 'activated'], 'all')).toEqual([signed]);
    expect(portfolioOperations(items, [], 'writer')).toEqual([creation]);
    expect(portfolioOperations(items, [], 'holder')).toEqual([activation, signed]);
  });
  it('uses recorded participant roles for requests, funding and cancelled-request cleanup', () => {
    const request: ActivityItem = {
      ...signed,
      id: 'request',
      side: 'holder',
      actorRole: 'holder',
      operation: 'create',
    };
    const funding: ActivityItem = {
      ...signed,
      id: 'funding',
      side: 'holder',
      actorRole: 'writer',
      operation: 'activate',
    };
    const cleanup: ActivityItem = {
      ...signed,
      id: 'cleanup',
      side: 'holder',
      actorRole: 'holder',
      operation: 'cleanup',
    };
    expect(portfolioOperations([request, funding, cleanup], [], 'holder')).toEqual([
      request,
      cleanup,
    ]);
    expect(portfolioOperations([request, funding, cleanup], [], 'writer')).toEqual([funding]);
    expect(asPending(funding)).toMatchObject({ side: 'holder', actorRole: 'writer' });
  });
  it('keeps unindexed server receipts without mistaking older local history for undiscovered agreements', () => {
    const latest = {
      ...signed,
      operation: 'create' as const,
      actorRole: 'writer' as const,
      status: 'finalized' as const,
      source: 'server' as const,
    };
    const older = { ...latest, id: 'older', agreement: 'older' };
    expect(portfolioOperations([latest, older], [], 'writer')).toEqual([latest, older]);
    expect(portfolioOperations([{ ...latest, source: 'browser' }], [], 'writer')).toEqual([]);
    expect(portfolioOperations([latest], [latest.agreement], 'writer')).toEqual([]);
    const cancel = { ...signed, operation: 'cancel' as const, actorRole: 'writer' as const };
    expect(portfolioOperations([cancel], [cancel.agreement], 'writer')).toEqual([cancel]);
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

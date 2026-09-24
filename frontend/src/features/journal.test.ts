import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearJournal, journalKey, readJournal, saveJournal } from './journal';

const owner = '11111111111111111111111111111111';
const saved = {
  side: 'writer' as const,
  actorRole: 'holder' as const,
  signature: '1'.repeat(64),
  lastValidBlockHeight: '100',
  owner,
  agreement: owner,
  operation: 'activate' as const,
};
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  };
}
beforeEach(() => {
  vi.stubGlobal('localStorage', storage());
});
afterEach(() => vi.unstubAllGlobals());

describe('durable public transaction journal', () => {
  it('isolates network, program and wallet; refuses a mismatched owner', () => {
    const key = journalKey('network', 'program', owner);
    saveJournal(key, saved);
    expect(readJournal(key, owner)).toEqual(saved);
    expect(readJournal(journalKey('other', 'program', owner), owner)).toBeNull();
    expect(readJournal(journalKey('network', 'other', owner), owner)).toBeNull();
    expect(() => readJournal(key, 'other')).toThrow('another wallet');
  });
  it('does not let stale confirmation clear a different pending signature', () => {
    saveJournal('journal', saved);
    clearJournal('journal', owner, 'different');
    expect(readJournal('journal', owner)).toEqual(saved);
    clearJournal('journal', owner, saved.signature);
    expect(readJournal('journal', owner)).toBeNull();
  });
});

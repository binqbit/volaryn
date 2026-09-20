import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearJournal,
  journalKey,
  migrateSessionJournal,
  readJournal,
  saveJournal,
} from './journal';

const owner = '11111111111111111111111111111111';
const saved = {
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
  vi.stubGlobal('sessionStorage', storage());
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
  it('migrates the legacy session record without silently replacing another transaction', () => {
    sessionStorage.setItem('volaryn:pending:network', JSON.stringify(saved));
    migrateSessionJournal('journal', 'network', owner);
    expect(readJournal('journal', owner)).toEqual(saved);
    expect(sessionStorage.getItem('volaryn:pending:network')).toBeNull();
    sessionStorage.setItem(
      'volaryn:pending:network',
      JSON.stringify({ ...saved, signature: '2'.repeat(64) }),
    );
    expect(() => migrateSessionJournal('journal', 'network', owner)).toThrow();
    expect(readJournal('journal', owner)).toEqual(saved);
  });
});

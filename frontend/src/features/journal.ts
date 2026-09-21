import { parsePending, type PendingTransaction } from './pending';

export function journalKey(genesis: string, program: string, owner: string) {
  return `volaryn:pending:${genesis}:${program}:${owner}`;
}

export function readJournal(key: string, owner: string): PendingTransaction | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const record = parsePending(raw);
  if (record.owner !== owner) throw new Error('Saved transaction belongs to another wallet');
  return record;
}

export async function withJournalLock<T>(key: string, action: () => Promise<T>) {
  if (!navigator.locks) throw new Error('Transaction tracking requires a secure browser context');
  return navigator.locks.request(key, { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error('Another tab is handling this wallet. Wait for it to finish.');
    return action();
  });
}

export function saveJournal(key: string, record: PendingTransaction) {
  localStorage.setItem(key, JSON.stringify(record));
}

export function clearJournal(key: string, owner: string, signature: string) {
  if (readJournal(key, owner)?.signature === signature) localStorage.removeItem(key);
}

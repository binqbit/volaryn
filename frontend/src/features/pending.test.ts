import { describe, expect, it } from 'vitest';
import { parsePending } from './pending';

const saved = {
  signature: '1'.repeat(64),
  lastValidBlockHeight: '9007199254740993',
  owner: '11111111111111111111111111111111',
  agreement: '11111111111111111111111111111111',
  operation: 'activate',
};
describe('pending transaction recovery', () => {
  it('restores public identifiers and exact block height without signed transaction bytes', () => {
    expect(parsePending(JSON.stringify({ ...saved, encoded: 'must not be retained' }))).toEqual(
      saved,
    );
  });
  it.each([
    { owner: 'bad' },
    { signature: 'bad' },
    { agreement: null },
    { operation: 'withdraw' },
    { lastValidBlockHeight: 12 },
    { lastValidBlockHeight: '-1' },
  ])('rejects malformed tracking state %j', (change) => {
    expect(() => parsePending(JSON.stringify({ ...saved, ...change }))).toThrow();
  });
});

it('requires complete public creation terms and discards unrelated saved values', () => {
  const createdTerms = {
    nonce: '1',
    quantityRaw: '10',
    payout: '20',
    premium: '1',
    acceptBefore: '1000',
    expiresAt: '2000',
    designatedHolder: null,
  };
  const record = { ...saved, operation: 'create', createdTerms };
  expect(parsePending(JSON.stringify(record))).toEqual(record);
  expect(() => parsePending(JSON.stringify({ ...record, createdTerms: null }))).toThrow();
  expect(() =>
    parsePending(JSON.stringify({ ...record, createdTerms: { ...createdTerms, payout: 20 } })),
  ).toThrow();
});

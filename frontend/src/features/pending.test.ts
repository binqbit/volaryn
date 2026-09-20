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

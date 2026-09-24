import { beforeAll, describe, expect, it } from 'vitest';
import type { Deployment } from '../../frontend/src/lib/api/client';
import { VOLARYN_PROGRAM_ADDRESS } from '@volaryn/protocol';
import { fixtureAssets } from '../../tools/localnet/assets';
import { fixtureSigners, recipe } from '../../tools/localnet/identity';
import { checkLocalManifest } from '../../tools/localnet/manifest';

let expected: Deployment;
let previous: Record<string, unknown>;
beforeAll(async () => {
  const keys = await fixtureSigners();
  const assets = (await fixtureAssets()).map(({ asset }) => asset);
  const identity = {
    mode: 'localnet',
    genesisHash: keys.authority.address,
    programId: VOLARYN_PROGRAM_ADDRESS,
    programSha256: 'a'.repeat(64),
    programLength: 1234,
    authority: keys.authority.address,
    usdcMint: keys.usdc.address,
    assets,
  };
  const participants = {
    fixtureVersion: recipe.version,
    holder: keys.holder.address,
    writer: keys.writer.address,
    holderUsdc: keys.holderUsdc.address,
    writerUsdc: keys.writerUsdc.address,
  };
  previous = { schemaVersion: 2, ...identity, ...participants };
  expected = {
    schemaVersion: 3,
    ...identity,
    upgradeAuthority: keys.authority.address,
    localnet: participants,
  };
});

describe('local fixture manifest compatibility', () => {
  it('accepts the previous layout without altering its ledger, assets or participants', () => {
    const before = structuredClone(previous);
    expect(checkLocalManifest(previous, expected)).toBe(true);
    expect(previous).toEqual(before);
  });

  it('accepts the current layout without requesting an update', () => {
    expect(checkLocalManifest(structuredClone(expected), expected)).toBe(false);
  });

  it.each([
    ['genesisHash', 'different-ledger'],
    ['programId', 'different-program'],
    ['programSha256', 'b'.repeat(64)],
    ['programLength', 4321],
    ['authority', 'different-authority'],
    ['holder', 'different-holder'],
    ['writer', 'different-writer'],
    ['holderUsdc', 'different-account'],
    ['writerUsdc', 'different-account'],
    ['usdcMint', 'different-currency'],
    ['assets', []],
    ['fixtureVersion', 2],
    ['schemaVersion', 1],
    ['mode', 'mainnet'],
    ['unknownField', true],
  ])('rejects a changed %s instead of rewriting identity', (key, value) => {
    expect(() => checkLocalManifest({ ...previous, [String(key)]: value }, expected)).toThrow(
      'Deployment identity differs',
    );
  });

  it('rejects malformed metadata and never converts a mainnet deployment', () => {
    for (const value of [null, false, [], {}, { schemaVersion: 2 }])
      expect(() => checkLocalManifest(value, expected)).toThrow();
    expect(() =>
      checkLocalManifest(previous, { ...expected, mode: 'mainnet', localnet: null }),
    ).toThrow();
    expect(() => checkLocalManifest(previous, { ...expected, upgradeAuthority: null })).toThrow();
  });
});

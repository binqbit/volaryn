import { beforeAll, describe, expect, it } from 'vitest';
import type { Deployment } from '../../frontend/src/lib/api/client';
import { VOLARYN_PROGRAM_ADDRESS } from '@volaryn/protocol';
import { fixtureAssets } from '../../tools/localnet/assets';
import { fixtureSigners, recipe } from '../../tools/localnet/identity';
import { checkLocalManifest } from '../../tools/localnet/manifest';

let expected: Deployment;
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
  expected = {
    schemaVersion: 3,
    ...identity,
    upgradeAuthority: keys.authority.address,
    localnet: participants,
  };
});

describe('local fixture manifest identity', () => {
  it('accepts repeated current-format checks without altering recorded identity', () => {
    const existing = structuredClone(expected);
    expect(() => checkLocalManifest(existing, expected)).not.toThrow();
    expect(() => checkLocalManifest(existing, expected)).not.toThrow();
    expect(existing).toEqual(expected);
  });

  it('rejects an unsupported layout instead of converting it', () => {
    const { localnet, upgradeAuthority, ...identity } = expected;
    const unsupported = { ...identity, schemaVersion: 2, ...localnet };
    expect(upgradeAuthority).toBe(expected.authority);
    const before = structuredClone(unsupported);
    expect(() => checkLocalManifest(unsupported, expected)).toThrow(
      'docs/development.md#local-development-reset',
    );
    expect(unsupported).toEqual(before);
  });

  it.each([
    ['genesisHash', 'different-ledger'],
    ['programId', 'different-program'],
    ['programSha256', 'b'.repeat(64)],
    ['programLength', 4321],
    ['authority', 'different-authority'],
    ['upgradeAuthority', null],
    ['usdcMint', 'different-currency'],
    ['assets', []],
    ['schemaVersion', 2],
    ['mode', 'mainnet'],
    ['unknownField', true],
  ])('rejects a changed %s instead of rewriting identity', (key, value) => {
    expect(() => checkLocalManifest({ ...expected, [String(key)]: value }, expected)).toThrow(
      'Deployment format or identity differs',
    );
  });

  it.each([
    ['holder', 'different-holder'],
    ['writer', 'different-writer'],
    ['holderUsdc', 'different-account'],
    ['writerUsdc', 'different-account'],
    ['fixtureVersion', 2],
  ])('rejects a changed local %s', (key, value) => {
    expect(() =>
      checkLocalManifest(
        { ...expected, localnet: { ...expected.localnet, [String(key)]: value } },
        expected,
      ),
    ).toThrow('Deployment format or identity differs');
  });

  it('rejects malformed metadata and nonlocal or unsupported expected formats', () => {
    for (const value of [null, false, [], {}, { schemaVersion: 2 }])
      expect(() => checkLocalManifest(value, expected)).toThrow();
    for (const invalid of [
      { ...expected, mode: 'mainnet' },
      { ...expected, schemaVersion: 2 },
      { ...expected, localnet: null },
      { ...expected, upgradeAuthority: null },
    ])
      expect(() => checkLocalManifest(invalid, invalid)).toThrow();
  });
});

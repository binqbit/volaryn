import { expect, it } from 'vitest';
import { localPolicyTerms, needsFixturePolicyUpgrade } from '../../tools/localnet/policy';

const original = { version: 1, enabled: true, reviewedUntil: 1700000000n, maxExpiry: 1700000000n };

it('replaces the original fixture cutoff once, including expired admission', () => {
  expect(needsFixturePolicyUpgrade(original)).toBe(true);
  expect(localPolicyTerms.enabled).toBe(true);
  // The local demo remains usable beyond the original one-day initialization window.
  expect(localPolicyTerms.reviewedUntil).toBeGreaterThan(original.reviewedUntil + 365n * 86400n);
  expect(localPolicyTerms.maxExpiry).toBeGreaterThan(original.maxExpiry + 365n * 86400n);
  expect(needsFixturePolicyUpgrade({ version: 2, ...localPolicyTerms })).toBe(false);
  expect(needsFixturePolicyUpgrade({ version: 1, ...localPolicyTerms })).toBe(false);
});

it('preserves disabled or deliberately revised policies', () => {
  expect(needsFixturePolicyUpgrade({ ...original, enabled: false })).toBe(false);
  expect(needsFixturePolicyUpgrade({ ...original, version: 2 })).toBe(false);
  expect(needsFixturePolicyUpgrade({ ...original, maxExpiry: original.maxExpiry + 1n })).toBe(
    false,
  );
});

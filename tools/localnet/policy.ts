import type { AssetPolicy } from '@volaryn/protocol';

// Disposable replicas have no issuer review deadline. Individual offers still expire.
export const localPolicyTerms = {
  enabled: true,
  reviewedUntil: 9223372036854775807n,
  maxExpiry: 9223372036854775807n,
};

export function needsFixturePolicyUpgrade(
  policy: Pick<AssetPolicy, 'version' | 'enabled' | 'reviewedUntil' | 'maxExpiry'>,
) {
  // Upgrade the original one-day fixture once; retain deliberately modified policies.
  return (
    policy.version === 1 &&
    policy.enabled &&
    policy.reviewedUntil === policy.maxExpiry &&
    policy.maxExpiry !== localPolicyTerms.maxExpiry
  );
}

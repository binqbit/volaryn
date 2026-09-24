// Disposable replicas have no issuer review deadline. Individual offers still expire.
export const localPolicyTerms = {
  enabled: true,
  reviewedUntil: 9223372036854775807n,
  maxExpiry: 9223372036854775807n,
};

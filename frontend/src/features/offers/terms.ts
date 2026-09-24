import { formatUnits, parseUnits } from '../../lib/api/client';

export type OfferPolicy = {
  enabled: boolean;
  reviewedUntil: bigint;
  maxExpiry: bigint;
};

type SuggestedDates =
  { acceptBefore: string; expiresAt: string; limited: boolean } | { error: string };

const latestDate = 253402300799n;

/** Form dates are UTC, even though datetime-local inputs have no timezone suffix. */
export function formatUtcDate(seconds: bigint): string {
  if (seconds < 0n || seconds > latestDate)
    throw new Error('Enter a UTC deadline between 1970 and 9999');
  return new Date(Number(seconds) * 1000).toISOString().slice(0, 19);
}

export function utcSeconds(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value))
    throw new Error('Enter a valid UTC deadline');
  const normalized = value.length === 16 ? `${value}:00` : value;
  const milliseconds = Date.parse(`${normalized}Z`);
  if (!Number.isFinite(milliseconds) || milliseconds < 0)
    throw new Error('Enter a valid UTC deadline');
  const seconds = BigInt(milliseconds / 1000);
  if (formatUtcDate(seconds) !== normalized) throw new Error('Enter a valid UTC deadline');
  return seconds.toString();
}

/** Policy limits constrain editable templates; they do not forecast market risk. */
export function suggestDates(
  now: bigint,
  policy: OfferPolicy,
  durationSeconds: bigint,
  acceptanceSeconds: bigint,
): SuggestedDates {
  if (!policy.enabled) return { error: 'This asset is not enabled for new offers.' };
  if (now >= policy.reviewedUntil)
    return { error: "This asset's approval has expired. New offers require a renewed approval." };
  if (now < 0n || now > latestDate || durationSeconds <= 0n || acceptanceSeconds <= 0n)
    return { error: 'Choose a valid protection duration and acceptance window.' };

  const requestedExpiry = now + durationSeconds;
  const requestedAcceptance = now + acceptanceSeconds;
  // Clamp finite template dates before converting: local policies can use i64::MAX.
  const expiry = requestedExpiry < policy.maxExpiry ? requestedExpiry : policy.maxExpiry;
  const acceptance = [requestedAcceptance, expiry - 1n, policy.reviewedUntil - 1n].reduce(
    (earliest, candidate) => (candidate < earliest ? candidate : earliest),
  );
  if (acceptance - now < 60n)
    return { error: 'The approval leaves less than one minute to accept a new offer.' };
  if (expiry > latestDate) return { error: 'Choose a protection expiry before the year 10000.' };
  return {
    acceptBefore: formatUtcDate(acceptance),
    expiresAt: formatUtcDate(expiry),
    limited: expiry < requestedExpiry || acceptance < requestedAcceptance,
  };
}

function positiveAmount(value: string, name: string): bigint {
  const raw = parseUnits(value);
  if (raw === 0n) throw new Error(`${name} must be greater than zero`);
  return raw;
}

/** Round upward to a whole USDC base unit, using exact integer arithmetic. */
export function premiumForRate(payout: string, ratePercent: string): string {
  const raw = positiveAmount(payout, 'Payout');
  const basisPoints = parseUnits(ratePercent, 2);
  if (basisPoints === 0n || basisPoints > 10000n)
    throw new Error('Enter a premium rate greater than 0% and at most 100%');
  return formatUnits(((raw * basisPoints + 9999n) / 10000n).toString());
}

/** Display-only percentage: never round-trip it into a manually entered premium. */
export function rateForPremium(payout: string, premium: string): string {
  const payoutRaw = positiveAmount(payout, 'Payout');
  const premiumRaw = positiveAmount(premium, 'Premium');
  const basisPoints = (premiumRaw * 10000n + payoutRaw / 2n) / payoutRaw;
  return formatUnits(basisPoints.toString(), 2);
}

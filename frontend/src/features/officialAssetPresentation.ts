import type { components } from '../lib/api/schema';

/** Only group observed rules shared by the full catalog, independently of the search filter. */
export function sharedTransferRestrictions(
  assets: components['schemas']['OfficialAsset'][],
): string[] {
  if (assets.length < 2 || assets.some((asset) => !asset.chain)) return [];
  return [...new Set(assets[0]!.chain!.restrictions)].filter((restriction) =>
    assets.every((asset) => asset.chain!.restrictions.includes(restriction)),
  );
}

const price = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const scientificPrice = new Intl.NumberFormat('en-US', {
  notation: 'scientific',
  maximumFractionDigits: 4,
});
const date = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Approximate issuer context only. Settlement amounts keep their exact integer formatting. */
export function formatSourcePrice(value: string | null | undefined): string {
  if (value == null || value.trim() === '') return 'Unavailable';
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 'Unavailable';
  // Preserve a nonzero source value if it is below JavaScript's numeric range.
  if (number === 0 && /[1-9]/.test(value.split(/[eE]/)[0]!)) return value;
  return (number >= 1e9 || (number > 0 && number < 0.0001) ? scientificPrice : price).format(
    number,
  );
}

export function formatPolicyDate(timestamp: number): string {
  return date.format(timestamp * 1000);
}

export function protectionDeadline(policy: components['schemas']['ReviewedAsset']): number {
  return policy.conversionDeadline == null
    ? policy.maxExpiry
    : Math.min(policy.maxExpiry, policy.conversionDeadline - policy.expiryBufferSeconds);
}

export function formatBuffer(seconds: number): string {
  const parts: string[] = [];
  for (const [unit, size] of [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ] as const) {
    const count = Math.floor(seconds / size);
    if (count > 0) parts.push(`${count} ${unit}${count === 1 ? '' : 's'}`);
    seconds %= size;
  }
  return parts.join(' ') || '0 seconds';
}

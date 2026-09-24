import { describe, expect, it } from 'vitest';
import {
  formatUtcDate,
  premiumForRate,
  rateForPremium,
  suggestDates,
  utcSeconds,
  type OfferPolicy,
} from './terms';

const now = 1790208000n;
const hour = 3600n;
const day = 24n * hour;
const policy: OfferPolicy = {
  enabled: true,
  reviewedUntil: now + 30n * day,
  maxExpiry: now + 30n * day,
};

describe('editable offer date suggestions', () => {
  it('keeps the requested duration when the selected asset permits it', () => {
    expect(suggestDates(now, policy, 7n * day, day)).toEqual({
      acceptBefore: formatUtcDate(now + day),
      expiresAt: formatUtcDate(now + 7n * day),
      limited: false,
    });
  });

  it('caps protection to the actual policy and leaves acceptance before expiry', () => {
    expect(suggestDates(now, { ...policy, maxExpiry: now + hour }, 7n * day, day)).toEqual({
      acceptBefore: formatUtcDate(now + hour - 1n),
      expiresAt: formatUtcDate(now + hour),
      limited: true,
    });
  });

  it('caps acceptance to approval validity without shortening permitted protection', () => {
    expect(suggestDates(now, { ...policy, reviewedUntil: now + hour }, 7n * day, day)).toEqual({
      acceptBefore: formatUtcDate(now + hour - 1n),
      expiresAt: formatUtcDate(now + 7n * day),
      limited: true,
    });
  });

  it('handles unlimited localnet policy sentinels without converting them to dates', () => {
    expect(
      suggestDates(
        now,
        { enabled: true, reviewedUntil: 9223372036854775807n, maxExpiry: 9223372036854775807n },
        2n * hour,
        hour,
      ),
    ).toEqual({
      acceptBefore: formatUtcDate(now + hour),
      expiresAt: formatUtcDate(now + 2n * hour),
      limited: false,
    });
  });

  it.each([
    ['disabled', { ...policy, enabled: false }],
    ['at review deadline', { ...policy, reviewedUntil: now }],
    ['past review deadline', { ...policy, reviewedUntil: now - 1n }],
    ['past expiry limit', { ...policy, maxExpiry: now }],
    ['near expiry limit', { ...policy, maxExpiry: now + 60n }],
    ['near review deadline', { ...policy, reviewedUntil: now + 60n }],
  ] as const)('rejects policies without an actionable acceptance window: %s', (_, policy) => {
    expect(suggestDates(now, policy, day, hour)).toHaveProperty('error');
  });

  it('accepts the boundary of one full actionable minute', () => {
    expect(suggestDates(now, { ...policy, reviewedUntil: now + 61n }, day, hour)).toEqual({
      acceptBefore: formatUtcDate(now + 60n),
      expiresAt: formatUtcDate(now + day),
      limited: true,
    });
  });

  it.each([
    [0n, hour],
    [-day, hour],
    [day, 0n],
    [day, -hour],
  ])('rejects invalid duration %s and acceptance window %s', (duration, acceptance) => {
    expect(suggestDates(now, policy, duration, acceptance)).toHaveProperty('error');
  });

  it('returns a clear error for an unrepresentable expiry', () => {
    const unlimited = {
      enabled: true,
      reviewedUntil: 9223372036854775807n,
      maxExpiry: 9223372036854775807n,
    };
    expect(suggestDates(now, unlimited, 253402300799n, day)).toHaveProperty('error');
  });
});

describe('UTC form dates', () => {
  it('accepts real calendar dates with minute or second precision', () => {
    expect(utcSeconds('2028-02-29T12:30')).toBe(utcSeconds('2028-02-29T12:30:00'));
    expect(formatUtcDate(BigInt(utcSeconds('2028-02-29T12:30:59')))).toBe('2028-02-29T12:30:59');
    expect(formatUtcDate(0n)).toBe('1970-01-01T00:00:00');
    expect(formatUtcDate(253402300799n)).toBe('9999-12-31T23:59:59');
  });

  it.each([
    '',
    '2027-02-29T12:30:00',
    '2026-04-31T12:30:00',
    '2026-09-24T24:00:00',
    '2026-09-24T12:30:00Z',
    '2026-09-24T12:30:00+01:00',
    '2026-09-24',
    '1969-12-31T23:59:59',
    '+010000-01-01T00:00:00',
  ])('rejects invalid or ambiguous form date %s', (value) => {
    expect(() => utcSeconds(value)).toThrow();
  });

  it.each([-1n, 253402300800n, 9223372036854775807n])(
    'rejects timestamps outside the supported form range: %s',
    (value) => {
      expect(() => formatUtcDate(value)).toThrow();
    },
  );
});

describe('premium percentage templates', () => {
  it('calculates exact USDC premiums from a manually chosen rate', () => {
    expect(premiumForRate('20', '2.5')).toBe('0.5');
    expect(premiumForRate('50.123456', '1.25')).toBe('0.626544');
    expect(premiumForRate('0.000001', '0.01')).toBe('0.000001');
  });

  it('retains u64 precision without overflow in intermediate multiplication', () => {
    expect(premiumForRate('18446744073709.551615', '100')).toBe('18446744073709.551615');
    expect(premiumForRate('18446744073709.551615', '50')).toBe('9223372036854.775808');
  });

  it.each(['0', '-1', '', '01', '1e2', '100.01', '2.501'])(
    'rejects invalid or out-of-range rate %s',
    (rate) => {
      expect(() => premiumForRate('20', rate)).toThrow();
    },
  );

  it.each(['0', '-1', '', '1e2', '0.0000001', '18446744073709.551616'])(
    'rejects invalid or overflowing payout %s',
    (payout) => {
      expect(() => premiumForRate(payout, '2.5')).toThrow();
    },
  );

  it('formats the approximate premium rate without rounding the actual premium', () => {
    expect(rateForPremium('20', '0.5')).toBe('2.5');
    expect(rateForPremium('3', '1')).toBe('33.33');
    expect(rateForPremium('3', '2')).toBe('66.67');
    expect(rateForPremium('200', '0.01')).toBe('0.01');
    expect(rateForPremium('1000', '0.000001')).toBe('0');
    expect(rateForPremium('1', '2')).toBe('200');
  });

  it.each([
    ['0', '1'],
    ['1', '0'],
    ['1', '18446744073709.551616'],
  ])('rejects an invalid percentage pair %s / %s', (payout, premium) => {
    expect(() => rateForPremium(payout, premium)).toThrow();
  });
});

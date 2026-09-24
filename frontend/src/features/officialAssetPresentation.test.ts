import { describe, expect, it } from 'vitest';
import registry from '../../../config/assets.json';
import {
  formatBuffer,
  formatPolicyDate,
  formatSourcePrice,
  protectionDeadline,
} from './officialAssetPresentation';

describe('issuer context presentation', () => {
  it.each([
    ['143.82393246574802', '143.8239'],
    ['120.6869953806347', '120.687'],
    ['0', '0'],
    ['0.000001234567', '1.2346E-6'],
    ['14382393246574802', '1.4382E16'],
    ['1e-400', '1e-400'],
    [null, 'Unavailable'],
    [undefined, 'Unavailable'],
    ['', 'Unavailable'],
    ['Infinity', 'Unavailable'],
    ['-1', 'Unavailable'],
  ])('formats source %s without implying currency or a missing zero', (source, display) => {
    expect(formatSourcePrice(source)).toBe(display);
  });

  it('uses the tighter reviewed or issuer deadline and keeps the date in UTC', () => {
    const policy = registry.assets.find((asset) => asset.symbol === 'SPACEX')!;
    expect(protectionDeadline(policy)).toBe(policy.maxExpiry);
    const extendedReview = { ...policy, maxExpiry: policy.conversionDeadline! + 86400 };
    expect(protectionDeadline(extendedReview)).toBe(policy.conversionDeadline! - 86400);
    expect(protectionDeadline({ ...policy, conversionDeadline: null })).toBe(policy.maxExpiry);
    expect(formatPolicyDate(policy.conversionDeadline!)).toBe('12 Mar 2027');
  });

  it('keeps the complete buffer while translating seconds into readable units', () => {
    expect(formatBuffer(86400)).toBe('1 day');
    expect(formatBuffer(176461)).toBe('2 days 1 hour 1 minute 1 second');
    expect(formatBuffer(0)).toBe('0 seconds');
  });
});

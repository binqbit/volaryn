import { describe, expect, it } from 'vitest';
import { parseUnits, amount, formatUnits } from './client';

describe('financial boundary', () => {
  it('retains all u64 digits without passing through Number', () => {
    expect(amount('18446744073709551615')).toBe(18446744073709551615n);
    expect(formatUnits('18446744073709551615')).toBe('18446744073709.551615');
    expect(formatUnits('1')).toBe('0.000001');
    expect(formatUnits('0')).toBe('0');
  });
  it.each(['-1', '1.5', '1e6', '01', '18446744073709551616', '', ' 1'])(
    'rejects ambiguous or out-of-range amount %s',
    (raw) => {
      expect(() => amount(raw)).toThrow();
    },
  );
});

describe('exact decimal inputs', () => {
  it('converts fractional and large values without floating-point rounding', () => {
    expect(parseUnits('9007199254.740993')).toBe(9007199254740993n);
    expect(parseUnits('18446744073709.551615')).toBe(18446744073709551615n);
    expect(parseUnits('0.000001')).toBe(1n);
    expect(formatUnits('36893488147419103230')).toBe('36893488147419.10323');
  });
  it.each(['-1', '1e6', '1.0000001', '01', '18446744073709.551616', 'NaN'])(
    'rejects invalid input %s',
    (value) => {
      expect(() => parseUnits(value)).toThrow();
    },
  );
});

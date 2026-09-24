import { describe, expect, it } from 'vitest';
import { offerPricing, type Premium } from './pricing';

describe('offer pricing source', () => {
  it('preserves the exact manually entered premium when its percentage rounds', () => {
    const input: Premium = { kind: 'amount', value: '1.123456' };
    expect(offerPricing('3', input)).toEqual({
      premium: '1.123456',
      rate: '37.45',
      net: '1.876544',
      error: '',
    });
    expect(offerPricing('7', input)).toEqual({
      premium: '1.123456',
      rate: '16.05',
      net: '5.876544',
      error: '',
    });
    expect(input).toEqual({ kind: 'amount', value: '1.123456' });
  });

  it('recalculates the premium when payout changes and the rate is the chosen source', () => {
    const input: Premium = { kind: 'rate', value: '2.5' };
    expect(offerPricing('20', input)).toEqual({
      premium: '0.5',
      rate: '2.5',
      net: '19.5',
      error: '',
    });
    expect(offerPricing('40', input)).toEqual({
      premium: '1',
      rate: '2.5',
      net: '39',
      error: '',
    });
  });

  it('changes the pricing basis only after an explicit edit to the other field', () => {
    const fixed = offerPricing('3', { kind: 'amount', value: '1' });
    expect(fixed.premium).toBe('1');
    expect(fixed.rate).toBe('33.33');
    const editedRate = offerPricing('3', { kind: 'rate', value: fixed.rate });
    expect(editedRate.premium).toBe('0.9999');
    expect(offerPricing('6', { kind: 'rate', value: fixed.rate }).premium).toBe('1.9998');
    expect(offerPricing('6', { kind: 'amount', value: fixed.premium }).premium).toBe('1');
  });

  it('keeps a positive micro premium even when the displayed percentage rounds to zero', () => {
    expect(offerPricing('1000', { kind: 'amount', value: '0.000001' })).toEqual({
      premium: '0.000001',
      rate: '0',
      net: '999.999999',
      error: '',
    });
  });

  it('rounds a percentage-based premium up without claiming a fractional USDC base unit', () => {
    expect(offerPricing('0.000001', { kind: 'rate', value: '0.01' })).toEqual({
      premium: '0.000001',
      rate: '0.01',
      net: '0',
      error: '',
    });
  });

  it('shows a negative net payout if the explicitly chosen premium exceeds payout', () => {
    expect(offerPricing('1', { kind: 'amount', value: '2.000001' })).toEqual({
      premium: '2.000001',
      rate: '200',
      net: '−1.000001',
      error: '',
    });
  });

  it('preserves full u64 precision in both inputs and the resulting economics', () => {
    expect(offerPricing('18446744073709.551615', { kind: 'amount', value: '0.000001' })).toEqual({
      premium: '0.000001',
      rate: '0',
      net: '18446744073709.551614',
      error: '',
    });
  });
});

describe('incomplete and invalid offer pricing', () => {
  it.each([
    ['', { kind: 'amount', value: '0.5' }, { premium: '0.5', rate: '' }],
    ['', { kind: 'rate', value: '2.5' }, { premium: '', rate: '2.5' }],
    ['20', { kind: 'amount', value: '' }, { premium: '', rate: '' }],
    ['20', { kind: 'rate', value: '' }, { premium: '', rate: '' }],
  ] as const)(
    'retains incomplete input without inventing a quote: %s / %o',
    (payout, input, result) => {
      expect(offerPricing(payout, input)).toEqual({ ...result, net: undefined, error: '' });
    },
  );

  it.each([
    ['-1', { kind: 'rate', value: '2.5' }],
    ['0', { kind: 'rate', value: '2.5' }],
    ['20', { kind: 'rate', value: '0' }],
    ['20', { kind: 'rate', value: '2.501' }],
    ['20', { kind: 'rate', value: '100.01' }],
    ['20', { kind: 'amount', value: '-1' }],
    ['20', { kind: 'amount', value: '0' }],
    ['20', { kind: 'amount', value: 'NaN' }],
    ['20', { kind: 'amount', value: '0.0000001' }],
    ['18446744073709.551616', { kind: 'amount', value: '0.5' }],
  ] as const)('reports invalid terms without derived economics: %s / %o', (payout, input) => {
    const pricing = offerPricing(payout, input);
    expect(pricing.error).not.toBe('');
    expect(pricing.net).toBeUndefined();
    expect(input.kind === 'amount' ? pricing.premium : pricing.rate).toBe(input.value);
  });
});

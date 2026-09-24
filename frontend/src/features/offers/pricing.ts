import { formatUnits, parseUnits } from '../../lib/api/client';
import { premiumForRate, rateForPremium } from './terms';

export type Premium = { kind: 'amount' | 'rate'; value: string };

/** Only an explicit edit changes the pricing basis; rounded percentages never feed back into money. */
export function offerPricing(payout: string, input: Premium) {
  let premium = input.kind === 'amount' ? input.value : '';
  let rate = input.kind === 'rate' ? input.value : '';
  let net: string | undefined;
  try {
    if (payout && input.value) {
      if (input.kind === 'rate') premium = premiumForRate(payout, input.value);
      else rate = rateForPremium(payout, input.value);
      const difference = parseUnits(payout) - parseUnits(premium);
      net = `${difference < 0n ? '−' : ''}${formatUnits((difference < 0n ? -difference : difference).toString())}`;
    }
    return { premium, rate, net, error: '' };
  } catch (cause) {
    return {
      premium,
      rate,
      net,
      error: cause instanceof Error ? cause.message : 'Check the payout and premium',
    };
  }
}

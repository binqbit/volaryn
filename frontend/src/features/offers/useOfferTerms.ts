import { useEffect, useState } from 'react';
import type { Asset, Deployment } from '../../lib/api/client';
import { offerPricing, type Premium } from './pricing';
import { suggestDates, utcSeconds } from './terms';
import { useOfferContext } from './useOfferContext';

type Dates = {
  mint: string;
  acceptBefore: string;
  expiresAt: string;
  editedAcceptance: boolean;
  editedExpiry: boolean;
};

export function useOfferTerms(deployment: Deployment, asset?: Asset) {
  const local = deployment.mode === 'localnet';
  const context = useOfferContext(deployment, asset);
  const [quantity, setQuantity] = useState('1');
  const [payout, setPayout] = useState('100');
  const [premiumInput, setPremiumInput] = useState<Premium>({ kind: 'rate', value: '10' });
  const [duration, setDuration] = useState(local ? '7200' : '604800');
  const [dates, setDates] = useState<Dates>({
    mint: '',
    acceptBefore: '',
    expiresAt: '',
    editedAcceptance: false,
    editedExpiry: false,
  });
  const data = context.data;
  const acceptanceWindow = local
    ? 3600n
    : BigInt(duration) / 2n < 86400n
      ? BigInt(duration) / 2n
      : 86400n;
  const suggested = data
    ? suggestDates(data.now, data.policy, BigInt(duration), acceptanceWindow)
    : undefined;

  // Initialize untouched fields once per selected mint. Polling never moves the user's deadlines.
  useEffect(() => {
    if (!data) return;
    const suggestion = suggestDates(data.now, data.policy, BigInt(duration), acceptanceWindow);
    if ('error' in suggestion) return;
    setDates((previous) =>
      previous.mint === data.mint
        ? previous
        : {
            ...previous,
            mint: data.mint,
            acceptBefore: previous.editedAcceptance
              ? previous.acceptBefore
              : suggestion.acceptBefore,
            expiresAt: previous.editedExpiry ? previous.expiresAt : suggestion.expiresAt,
          },
    );
  }, [data, duration, acceptanceWindow]);

  function applyDates() {
    if (!data || !suggested || 'error' in suggested) return;
    setDates({
      mint: data.mint,
      acceptBefore: suggested.acceptBefore,
      expiresAt: suggested.expiresAt,
      editedAcceptance: false,
      editedExpiry: false,
    });
  }

  let dateError = '';
  if (data) {
    if (!data.policy.enabled) dateError = 'New offers are disabled for this asset.';
    else if (data.now >= data.policy.reviewedUntil)
      dateError = 'This asset’s approval has expired. New offers require a renewed approval.';
    else if (dates.acceptBefore && dates.expiresAt) {
      try {
        const accept = BigInt(utcSeconds(dates.acceptBefore));
        const expiry = BigInt(utcSeconds(dates.expiresAt));
        if (accept <= data.now || expiry <= data.now)
          dateError = 'Choose future deadlines or apply suggested dates again.';
        else if (accept > expiry)
          dateError = 'Acceptance must end no later than protection expiry.';
        else if (expiry > data.policy.maxExpiry)
          dateError =
            'Protection expiry exceeds this asset’s approved limit. Choose an earlier date.';
        else if (accept >= data.policy.reviewedUntil)
          dateError = 'Acceptance must end before the asset’s approval expires.';
      } catch {
        dateError = 'Enter valid UTC deadlines.';
      }
    }
  }

  return {
    quantity,
    setQuantity,
    payout,
    setPayout,
    pricing: offerPricing(payout, premiumInput),
    premiumKind: premiumInput.kind,
    setPremium: (value: string) => setPremiumInput({ kind: 'amount', value }),
    setRate: (value: string) => setPremiumInput({ kind: 'rate', value }),
    duration,
    setDuration,
    dates,
    setAcceptance: (value: string) =>
      setDates((previous) => ({ ...previous, acceptBefore: value, editedAcceptance: true })),
    setExpiry: (value: string) =>
      setDates((previous) => ({ ...previous, expiresAt: value, editedExpiry: true })),
    applyDates,
    suggested,
    dateError,
    context,
  };
}

export type OfferTerms = ReturnType<typeof useOfferTerms>;

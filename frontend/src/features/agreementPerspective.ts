import type { Agreement } from '../lib/api/client';

export function agreementPerspective(
  agreement: Agreement,
  owner: string | undefined,
  now: bigint | undefined,
) {
  const writer = !!owner && agreement.writer === owner;
  const holder = !!owner && agreement.holder === owner;
  const designated = !!owner && agreement.designatedHolder === owner;
  const role = !owner
    ? 'Public agreement'
    : writer
      ? 'Your role: writer · capital provider'
      : holder
        ? 'Your role: protection holder · payout recipient'
        : agreement.status === 'funded' && designated
          ? 'Reserved for you · not activated'
          : agreement.status === 'funded' && !agreement.designatedHolder
            ? 'Prospective holder · not activated'
            : 'Your role: viewer';
  if (agreement.status === 'funded') {
    const ended = now !== undefined && now >= BigInt(agreement.acceptBefore);
    return {
      role,
      title: ended
        ? 'Acceptance ended'
        : writer
          ? 'Your offer is awaiting a holder'
          : 'Protection not activated',
      description: ended
        ? writer
          ? 'You can cancel this offer to recover your reserved USDC.'
          : 'This offer can no longer be accepted. Only its writer can recover the reserved USDC.'
        : writer
          ? 'Your USDC funds the payout. You receive the premium when a holder activates and receive PreStocks only if they exercise.'
          : 'The holder pays the premium to the writer. After activation, only that holder can deliver the PreStocks and receive the USDC payout.',
    };
  }
  if (agreement.status === 'active') {
    const expired = now !== undefined && now >= BigInt(agreement.expiresAt);
    return {
      role,
      title:
        now === undefined
          ? 'Protection activated · checking expiry'
          : expired
            ? writer
              ? 'Your reserve is available to reclaim'
              : holder
                ? 'Your protection has expired'
                : 'Protection expired'
            : holder
              ? 'Your protection is active'
              : writer
                ? 'Your offer has been activated'
                : 'Protection activated',
      description: expired
        ? writer
          ? 'The exercise window has ended. You can now return the reserved USDC to your wallet.'
          : holder
            ? 'You can no longer exercise or receive the payout. The writer can reclaim the reserve; the premium is not refunded.'
            : 'The exercise window has ended. Only the writer can reclaim the reserve.'
        : holder
          ? 'You own the exercise right. Deliver the agreed PreStocks before expiry to receive the USDC payout; the writer receives the tokens.'
          : writer
            ? 'The holder owns the exercise right and receives the payout if they deliver the PreStocks to you. Your reserved USDC stays locked until exercise or expiry.'
            : 'Only the holder can exercise this agreement and receive its USDC payout. The writer receives the delivered PreStocks.',
    };
  }
  if (agreement.status === 'exercised') {
    return {
      role,
      title: holder
        ? 'Your USDC payout was settled'
        : writer
          ? 'PreStocks delivered to your settlement account'
          : 'Protection exercised',
      description: holder
        ? 'The agreed USDC payout was transferred to your wallet. Your PreStocks were delivered to the writer; this protection cannot be exercised again.'
        : writer
          ? 'The holder received the USDC payout. You control the delivered PreStocks in the settlement account shown below.'
          : 'Settlement is complete: the holder received USDC, and the writer controls the delivered PreStocks.',
    };
  }
  return {
    role,
    title:
      agreement.status === 'cancelled'
        ? writer
          ? 'Your offer was cancelled'
          : 'Offer cancelled'
        : writer
          ? 'Your reserve was reclaimed'
          : holder
            ? 'Your protection expired without payout'
            : 'Protection expired · reserve reclaimed',
    description:
      agreement.status === 'cancelled'
        ? writer
          ? 'The reserved USDC was returned to you. No protection was activated.'
          : 'The reserved USDC was returned to the writer. No protection was activated.'
        : writer
          ? 'The unused USDC reserve was returned to you after expiry. No PreStocks were delivered.'
          : 'The unused reserve was returned to the writer after expiry. The holder received no payout; the premium is not refunded.',
  };
}

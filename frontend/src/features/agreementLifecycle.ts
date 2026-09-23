import type { Agreement } from '../lib/api/client';

export function agreementLifecycle(agreement: Agreement, now: bigint | undefined) {
  if (agreement.status === 'funded') {
    if (now === undefined) return { label: 'Funded · checking deadline', open: false };
    return now >= BigInt(agreement.acceptBefore)
      ? { label: 'Acceptance ended', open: false }
      : { label: 'Available', open: true };
  }
  if (agreement.status === 'active') {
    if (now === undefined) return { label: 'Active · checking deadline', open: false };
    return now >= BigInt(agreement.expiresAt)
      ? { label: 'Expired · awaiting reclaim', open: false }
      : { label: 'Active', open: true };
  }
  return {
    label:
      agreement.status === 'exercised'
        ? 'Exercised'
        : agreement.status === 'cancelled'
          ? 'Cancelled'
          : 'Expired · reserve reclaimed',
    open: false,
  };
}

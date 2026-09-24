import type { Agreement } from '../lib/api/client';
import type { ActivityItem } from './activity/model';

const labels = {
  activate: ['Activating protection…', 'Protection activated'],
  exercise: ['Exercising protection…', 'Protection exercised'],
  cancel: ['Cancelling offer…', 'Offer cancelled'],
  reclaim: ['Reclaiming reserve…', 'Reserve reclaimed'],
  cleanup: ['Recovering residual funds…', 'Residual funds recovered'],
} as const;

/** Operation feedback fills the gap before the finalized agreement read catches up. */
export function agreementAction(
  agreement: Agreement,
  owner: string | undefined,
  activity: ActivityItem[],
) {
  const attempt = activity
    .filter((item) => item.owner === owner && item.agreement === agreement.address)
    .sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt)[0];
  if (!attempt || attempt.operation === 'create') return undefined;
  const { operation, status } = attempt;
  // A later agreement state supersedes feedback about an earlier operation.
  if (
    ((operation === 'activate' || operation === 'cancel') && agreement.status !== 'open') ||
    ((operation === 'exercise' || operation === 'reclaim') && agreement.status !== 'active') ||
    (operation === 'cleanup' && ['open', 'active'].includes(agreement.status))
  )
    return undefined;
  const complete = status === 'finalized' || status === 'reconciled';
  // Residual recovery is repeatable; its completed attempt does not disable later recovery.
  if (complete && operation === 'cleanup') return undefined;
  const operationLabels =
    operation === 'activate' && agreement.side === 'holder'
      ? ['Funding protection…', 'Protection funded']
      : operation === 'cancel' && agreement.side === 'holder'
        ? ['Cancelling request…', 'Request cancelled']
        : labels[operation];
  const label = complete
    ? operationLabels[1]
    : status === 'preparing'
      ? 'Preparing transaction…'
      : status === 'awaiting-signature'
        ? 'Waiting for wallet approval…'
        : status === 'pending'
          ? operationLabels[0]
          : status === 'provisional'
            ? `${operationLabels[0]} Awaiting finality`
            : status === 'unresolved'
              ? 'Checking transaction status…'
              : undefined;
  return label ? { operation, label, complete } : undefined;
}

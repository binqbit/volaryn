import type { Instruction } from '@solana/kit';
import type { Agreement } from '../api/client';

export const operations = [
  'create',
  'activate',
  'exercise',
  'cancel',
  'reclaim',
  'cleanup',
] as const;
export type Operation = (typeof operations)[number];
export type OfferSide = 'writer' | 'holder';
export interface OfferTerms {
  side: OfferSide;
  underlyingMint: string;
  nonce: string;
  quantityRaw: string;
  payout: string;
  premium: string;
  acceptBefore: string;
  expiresAt: string;
  designatedCounterparty: string | null;
}
export type ActionRequest =
  | { operation: 'create'; terms: OfferTerms; usdcAccount: string }
  | {
      operation: Exclude<Operation, 'create'>;
      agreement: Agreement;
      usdcAccount: string;
      underlyingAccount?: string;
    };

export interface ActionReview {
  side: OfferSide;
  actorRole: OfferSide;
  escrowAmount: string;
  underlyingMint: string;
  underlyingDecimals: number;
  owner: string;
  agreement: string;
  operation: Operation;
  quantityRaw: string;
  payout: string;
  premium: string;
  acceptBefore: string;
  expiresAt: string;
  designatedCounterparty: string | null;
  usdcAccount: string;
  underlyingAccount: string | null;
  estimatedNetReceipt: string;
  issuerFee: string;
  networkFee: string;
  accountRent: string;
  reserveAmount: string | null;
  restrictions: string[];
}
export interface ActionPlan {
  instructions: Instruction[];
  review: ActionReview;
}

export function actionLabel(operation: Operation, side: OfferSide) {
  return {
    create: side === 'holder' ? 'Create protection request' : 'Create capital offer',
    activate: side === 'holder' ? 'Fund protection' : 'Activate protection',
    exercise: 'Exercise protection',
    cancel: side === 'holder' ? 'Cancel request' : 'Cancel offer',
    reclaim: 'Reclaim expired reserve',
    cleanup: 'Recover residual funds',
  }[operation];
}

export function actionRole(request: ActionRequest): OfferSide {
  if (request.operation === 'create') return request.terms.side;
  if (request.operation === 'activate')
    return request.agreement.side === 'holder' ? 'writer' : 'holder';
  if (request.operation === 'exercise') return 'holder';
  if (
    request.operation === 'cancel' ||
    (request.operation === 'cleanup' && request.agreement.status === 'cancelled')
  )
    return request.agreement.side;
  return 'writer';
}

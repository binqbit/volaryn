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
export interface OfferTerms {
  nonce: string;
  quantityRaw: string;
  payout: string;
  premium: string;
  acceptBefore: string;
  expiresAt: string;
  designatedHolder: string | null;
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
  owner: string;
  agreement: string;
  operation: Operation;
  quantityRaw: string;
  payout: string;
  premium: string;
  acceptBefore: string;
  expiresAt: string;
  designatedHolder: string | null;
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

export const actionLabels: Record<Operation, string> = {
  create: 'Create funded offer',
  activate: 'Activate protection',
  exercise: 'Exercise protection',
  cancel: 'Cancel offer',
  reclaim: 'Reclaim expired reserve',
  cleanup: 'Recover residual funds',
};

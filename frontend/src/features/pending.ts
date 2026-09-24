import { address, signature } from '@solana/kit';
import { amount } from '../lib/api/client';
import {
  operations,
  type OfferTerms,
  type Operation,
  type OfferSide,
} from '../lib/chain/actionTypes';

export interface PendingTransaction {
  side: OfferSide;
  actorRole: OfferSide;
  signature: string;
  lastValidBlockHeight: string;
  owner: string;
  agreement: string;
  operation: Operation;
  createdTerms?: OfferTerms;
}

export function parsePending(raw: string): PendingTransaction {
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== 'object' ||
    !('side' in value) ||
    !['writer', 'holder'].includes(value.side as string) ||
    !('actorRole' in value) ||
    !['writer', 'holder'].includes(value.actorRole as string) ||
    !('signature' in value) ||
    typeof value.signature !== 'string' ||
    !('lastValidBlockHeight' in value) ||
    typeof value.lastValidBlockHeight !== 'string' ||
    !('owner' in value) ||
    typeof value.owner !== 'string' ||
    !('agreement' in value) ||
    typeof value.agreement !== 'string' ||
    !('operation' in value) ||
    !operations.includes(value.operation as Operation)
  ) {
    throw new Error('Saved transaction state is invalid');
  }
  signature(value.signature);
  address(value.owner);
  address(value.agreement);
  amount(value.lastValidBlockHeight);
  const createdTerms =
    value.operation === 'create'
      ? parseOfferTerms('createdTerms' in value ? value.createdTerms : null)
      : undefined;
  if (createdTerms && (createdTerms.side !== value.side || value.actorRole !== value.side))
    throw new Error('Saved creation role does not match its offer side');
  if (
    (value.operation === 'activate' && value.actorRole === value.side) ||
    (value.operation === 'cancel' && value.actorRole !== value.side) ||
    (value.operation === 'exercise' && value.actorRole !== 'holder') ||
    (value.operation === 'reclaim' && value.actorRole !== 'writer')
  )
    throw new Error('Saved operation role is invalid');
  return {
    side: value.side as OfferSide,
    actorRole: value.actorRole as OfferSide,
    signature: value.signature,
    lastValidBlockHeight: value.lastValidBlockHeight,
    owner: value.owner,
    agreement: value.agreement,
    operation: value.operation as Operation,
    ...(createdTerms ? { createdTerms } : {}),
  };
}

export function parseOfferTerms(terms: unknown): OfferTerms {
  if (!terms || typeof terms !== 'object') throw new Error('Missing saved offer terms');
  if (!('side' in terms) || !['writer', 'holder'].includes(terms.side as string))
    throw new Error('Invalid offer side');
  for (const key of [
    'nonce',
    'quantityRaw',
    'payout',
    'premium',
    'acceptBefore',
    'expiresAt',
  ] as const) {
    if (!(key in terms) || typeof (terms as Record<string, unknown>)[key] !== 'string')
      throw new Error('Invalid saved offer terms');
    amount((terms as Record<string, string>)[key]!);
  }
  if (
    !('designatedCounterparty' in terms) ||
    (terms.designatedCounterparty !== null && typeof terms.designatedCounterparty !== 'string')
  )
    throw new Error('Invalid designated counterparty');
  if (terms.designatedCounterparty) address(terms.designatedCounterparty);
  if (!('underlyingMint' in terms) || typeof terms.underlyingMint !== 'string')
    throw new Error('Missing saved token identity');
  address(terms.underlyingMint);
  const checked = terms as OfferTerms;
  return {
    side: checked.side,
    underlyingMint: checked.underlyingMint,
    nonce: checked.nonce,
    quantityRaw: checked.quantityRaw,
    payout: checked.payout,
    premium: checked.premium,
    acceptBefore: checked.acceptBefore,
    expiresAt: checked.expiresAt,
    designatedCounterparty: checked.designatedCounterparty,
  };
}

import { address, signature } from '@solana/kit';
import { amount } from '../lib/api/client';
import { operations, type OfferTerms, type Operation } from '../lib/chain/actionTypes';

export interface PendingTransaction {
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
  return {
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
    !('designatedHolder' in terms) ||
    (terms.designatedHolder !== null && typeof terms.designatedHolder !== 'string')
  )
    throw new Error('Invalid designated holder');
  if (terms.designatedHolder) address(terms.designatedHolder);
  if (!('underlyingMint' in terms) || typeof terms.underlyingMint !== 'string')
    throw new Error('Missing saved token identity');
  address(terms.underlyingMint);
  const checked = terms as OfferTerms;
  return {
    underlyingMint: checked.underlyingMint,
    nonce: checked.nonce,
    quantityRaw: checked.quantityRaw,
    payout: checked.payout,
    premium: checked.premium,
    acceptBefore: checked.acceptBefore,
    expiresAt: checked.expiresAt,
    designatedHolder: checked.designatedHolder,
  };
}

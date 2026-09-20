import { address, signature } from '@solana/kit';
import { amount } from '../lib/api/client';

export interface PendingTransaction {
  signature: string;
  lastValidBlockHeight: string;
  owner: string;
  agreement: string;
  operation: 'activate' | 'exercise';
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
    (value.operation !== 'activate' && value.operation !== 'exercise')
  ) {
    throw new Error('Saved transaction state is invalid');
  }
  signature(value.signature);
  address(value.owner);
  address(value.agreement);
  amount(value.lastValidBlockHeight);
  return {
    signature: value.signature,
    lastValidBlockHeight: value.lastValidBlockHeight,
    owner: value.owner,
    agreement: value.agreement,
    operation: value.operation,
  };
}

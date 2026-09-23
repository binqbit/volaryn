import { address, isSome, unwrapOption, signature, type Rpc, type SolanaRpcApi } from '@solana/kit';
import {
  AgreementStatus,
  fetchMaybeAgreement,
  observeTransaction,
  protocolAddresses,
  VOLARYN_PROGRAM_ADDRESS,
} from '@volaryn/protocol';
import type { PendingTransaction } from './pending';

export async function observeAction(rpc: Rpc<SolanaRpcApi>, pending: PendingTransaction) {
  const state = await observeTransaction(rpc, pending);
  if (state !== 'unresolved') return state;

  // The finalized root must outlive the signed transaction. Account reads must
  // reach this root too; null signature history alone is never proof of failure.
  const root = await rpc.getEpochInfo({ commitment: 'finalized' }).send();
  if (root.blockHeight <= BigInt(pending.lastValidBlockHeight)) return 'pending';
  const { value } = await rpc
    .getSignatureStatuses([signature(pending.signature)], { searchTransactionHistory: true })
    .send();
  const status = value[0];
  if (status?.confirmationStatus === 'finalized') return status.err ? 'failed' : 'finalized';
  if (status) return 'unresolved';
  const account = await fetchMaybeAgreement(rpc, address(pending.agreement), {
    commitment: 'finalized',
    minContextSlot: root.absoluteSlot,
  });
  if (!account.exists) return pending.operation === 'create' ? 'expired' : 'unresolved';
  const agreement = account.data;
  const expected = await protocolAddresses(
    agreement.underlyingMint,
    agreement.writer,
    agreement.nonce,
  );
  if (
    account.programAddress !== VOLARYN_PROGRAM_ADDRESS ||
    agreement.version !== 1 ||
    expected.agreement !== pending.agreement
  )
    throw new Error('Agreement identity is unsupported');

  if (agreement.writer === pending.owner) {
    if (pending.operation === 'create') {
      const terms = pending.createdTerms;
      if (!terms) return 'unresolved';
      const matches = [
        'underlyingMint',
        'nonce',
        'quantityRaw',
        'payout',
        'premium',
        'acceptBefore',
        'expiresAt',
      ].every(
        (key) =>
          agreement[key as keyof typeof agreement]?.toString() === terms[key as keyof typeof terms],
      );
      return matches && unwrapOption(agreement.designatedHolder) === terms.designatedHolder
        ? 'reconciled'
        : 'unresolved';
    }
    if (pending.operation === 'cancel') {
      if (agreement.status === AgreementStatus.Cancelled) return 'reconciled';
      return 'expired';
    }
    if (pending.operation === 'reclaim') {
      if (agreement.status === AgreementStatus.Expired) return 'reconciled';
      return 'expired';
    }
    // Cleanup is repeatable and can recover later donations. Current balances
    // cannot prove whether an earlier cleanup executed; retain unknown outcomes.
    if (pending.operation === 'cleanup') return 'unresolved';
  }

  // Version 1 never transfers holders or reverses activation/settlement. These
  // facts prove the effect, not inclusion of this particular signature.
  if (pending.operation === 'activate') {
    if (!isSome(agreement.activatedAt)) return 'expired';
    if (isSome(agreement.holder))
      return agreement.holder.value === pending.owner ? 'reconciled' : 'expired';
  }
  if (
    pending.operation === 'exercise' &&
    isSome(agreement.holder) &&
    agreement.holder.value === pending.owner
  ) {
    if (agreement.status === AgreementStatus.Exercised) return 'reconciled';
    if (agreement.status === AgreementStatus.Active || agreement.status === AgreementStatus.Expired)
      return 'expired';
  }
  return 'unresolved';
}

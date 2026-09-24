import { address, isSome, unwrapOption, signature, type Rpc, type SolanaRpcApi } from '@solana/kit';
import {
  AgreementStatus,
  OfferSide,
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
    agreement.creator,
    agreement.nonce,
  );
  if (
    account.programAddress !== VOLARYN_PROGRAM_ADDRESS ||
    agreement.version !== 2 ||
    (agreement.side === OfferSide.Holder ? 'holder' : 'writer') !== pending.side ||
    expected.agreement !== pending.agreement
  )
    throw new Error('Agreement identity is unsupported');

  if (agreement.creator === pending.owner) {
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
      return matches &&
        terms.side === pending.side &&
        pending.actorRole === terms.side &&
        unwrapOption(agreement.designatedCounterparty) === terms.designatedCounterparty
        ? 'reconciled'
        : 'unresolved';
    }
    if (pending.operation === 'cancel' && pending.actorRole === pending.side) {
      if (agreement.status === AgreementStatus.Cancelled) return 'reconciled';
      return 'expired';
    }
  }
  if (unwrapOption(agreement.writer) === pending.owner && pending.actorRole === 'writer') {
    if (pending.operation === 'reclaim') {
      if (agreement.status === AgreementStatus.Expired) return 'reconciled';
      return 'expired';
    }
  }

  // Cleanup is repeatable; an account snapshot cannot prove an earlier recovery.
  if (pending.operation === 'cleanup') return 'unresolved';

  // Version 2 never transfers parties or reverses activation/settlement. These
  // facts prove the effect, not inclusion of this particular signature.
  if (pending.operation === 'activate') {
    const acceptingRole = pending.side === 'holder' ? 'writer' : 'holder';
    if (pending.actorRole !== acceptingRole) return 'unresolved';
    if (!isSome(agreement.activatedAt)) return 'expired';
    const participant = unwrapOption(agreement[acceptingRole]);
    if (participant) return participant === pending.owner ? 'reconciled' : 'expired';
  }
  if (
    pending.operation === 'exercise' &&
    pending.actorRole === 'holder' &&
    isSome(agreement.holder) &&
    agreement.holder.value === pending.owner
  ) {
    if (agreement.status === AgreementStatus.Exercised) return 'reconciled';
    if (agreement.status === AgreementStatus.Active || agreement.status === AgreementStatus.Expired)
      return 'expired';
  }
  return 'unresolved';
}

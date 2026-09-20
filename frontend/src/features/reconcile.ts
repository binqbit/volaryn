import { address, isSome, signature, type Rpc, type SolanaRpcApi } from '@solana/kit';
import {
  AgreementStatus,
  fetchAgreement,
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
  const account = await fetchAgreement(rpc, address(pending.agreement), {
    commitment: 'finalized',
    minContextSlot: root.absoluteSlot,
  });
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

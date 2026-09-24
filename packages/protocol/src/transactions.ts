import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  compileTransaction,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  signature,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
  type Base64EncodedWireTransaction,
} from '@solana/kit';

export interface PreparedTransaction {
  signature: string;
  encoded: Base64EncodedWireTransaction;
  lastValidBlockHeight: string;
  blockhash: string;
}

export async function prepareTransaction(
  rpc: Rpc<SolanaRpcApi>,
  payer: TransactionSigner,
  instructions: readonly Instruction[],
  beforeSign?: () => Promise<void>,
): Promise<PreparedTransaction> {
  const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(lifetime, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  );
  // Wallet Standard signers may modify messages. Pin the approved bytes, including
  // the blockhash, so returned signatures cannot change terms or recovery lifetime.
  const reviewedMessage = new Uint8Array(compileTransaction(message).messageBytes);
  await beforeSign?.();
  const transaction = await signTransactionMessageWithSigners(message);
  if (
    transaction.messageBytes.length !== reviewedMessage.length ||
    !transaction.messageBytes.every((byte, index) => byte === reviewedMessage[index])
  )
    throw new Error('Wallet changed the reviewed transaction. Review and sign again.');
  return {
    signature: getSignatureFromTransaction(transaction),
    encoded: getBase64EncodedWireTransaction(transaction),
    lastValidBlockHeight: lifetime.lastValidBlockHeight.toString(),
    blockhash: lifetime.blockhash,
  };
}

/** Quote the unsigned message through RPC; no wallet signature is requested. */
export async function estimateFee(
  rpc: Rpc<SolanaRpcApi>,
  payer: TransactionSigner,
  instructions: readonly Instruction[],
) {
  const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (tx) => setTransactionMessageFeePayerSigner(payer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(lifetime, tx),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
  );
  const bytes = compileTransaction(message).messageBytes;
  const { value } = await rpc
    .getFeeForMessage(
      getBase64Decoder().decode(bytes) as Parameters<typeof rpc.getFeeForMessage>[0],
      { commitment: 'confirmed' },
    )
    .send();
  if (value === null) throw new Error('The network fee estimate is unavailable');
  return value;
}

export async function submitTransaction(rpc: Rpc<SolanaRpcApi>, prepared: PreparedTransaction) {
  const submitted = await rpc
    .sendTransaction(prepared.encoded, {
      encoding: 'base64',
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 6n,
    })
    .send();
  if (submitted !== prepared.signature)
    throw new Error('RPC returned a different transaction signature');
  return submitted;
}

export async function observeTransaction(
  rpc: Rpc<SolanaRpcApi>,
  pending: Pick<PreparedTransaction, 'signature' | 'lastValidBlockHeight'>,
) {
  const { value } = await rpc
    .getSignatureStatuses([signature(pending.signature)], { searchTransactionHistory: true })
    .send();
  const status = value[0];
  if (status?.confirmationStatus === 'finalized')
    return status.err ? ('failed' as const) : ('finalized' as const);
  if (status?.confirmationStatus === 'confirmed') return 'provisional' as const;
  // Missing status alone cannot prove that the transaction failed. After expiry,
  // retain the signature for reconciliation instead of automatically resubmitting.
  const height = await rpc.getBlockHeight({ commitment: 'finalized' }).send();
  return height > BigInt(pending.lastValidBlockHeight)
    ? ('unresolved' as const)
    : ('pending' as const);
}

export async function sendAndFinalize(
  rpc: Rpc<SolanaRpcApi>,
  payer: TransactionSigner,
  instructions: readonly Instruction[],
) {
  const prepared = await prepareTransaction(rpc, payer, instructions);
  await submitTransaction(rpc, prepared);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const status = await observeTransaction(rpc, prepared);
    if (status === 'finalized') return prepared.signature;
    if (status === 'failed') throw new Error(`Transaction failed: ${prepared.signature}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Transaction outcome unresolved: ${prepared.signature}`);
}

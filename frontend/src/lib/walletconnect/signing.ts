import {
  address,
  getBase58Encoder,
  getBase64Encoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  getTransactionEncoder,
  signatureBytes,
  verifySignature,
  type Address,
  type Transaction,
} from '@solana/kit';

/** Both response forms are defined by Reown's Solana JSON-RPC signing contract. */
export async function decodeSignedTransaction(
  transaction: Transaction,
  owner: Address,
  response: unknown,
): Promise<Uint8Array> {
  if (!response || typeof response !== 'object') throw new Error('Invalid wallet response');
  let signed;
  if ('transaction' in response && typeof response.transaction === 'string') {
    signed = getTransactionDecoder().decode(getBase64Encoder().encode(response.transaction));
  } else if ('signature' in response && typeof response.signature === 'string') {
    signed = {
      ...transaction,
      signatures: {
        ...transaction.signatures,
        [owner]: signatureBytes(getBase58Encoder().encode(response.signature)),
      },
    };
  } else {
    throw new Error('Invalid wallet response');
  }
  if (
    signed.messageBytes.length !== transaction.messageBytes.length ||
    !signed.messageBytes.every((byte, index) => byte === transaction.messageBytes[index])
  )
    throw new Error('Wallet changed the transaction');
  for (const [signer, original] of Object.entries(transaction.signatures)) {
    if (
      signer !== owner &&
      original &&
      !original.every((byte, index) => byte === signed.signatures[address(signer)]?.[index])
    )
      throw new Error('Wallet changed an existing signature');
  }
  const signature = signed.signatures[owner];
  if (
    !signature ||
    !(await verifySignature(await getPublicKeyFromAddress(owner), signature, signed.messageBytes))
  )
    throw new Error('Wallet returned an invalid signature');
  return new Uint8Array(getTransactionEncoder().encode(signed));
}

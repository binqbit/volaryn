import { describe, expect, it } from 'vitest';
import {
  address,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  assertIsTransactionWithinSizeLimit,
  blockhash,
  compileTransaction,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  getBase64Encoder,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  type RpcTransport,
  type TransactionModifyingSigner,
} from '@solana/kit';
import { prepareTransaction, observeTransaction } from '@volaryn/protocol';

const pending = { signature: '1'.repeat(64), lastValidBlockHeight: '100' };
function rpc(status: unknown, height = 90) {
  const transport: RpcTransport = async <TResponse>({ payload }: Parameters<RpcTransport>[0]) => {
    const { method } = payload as { method: string };
    return {
      jsonrpc: '2.0',
      id: 1,
      result:
        method === 'getSignatureStatuses' ? { context: { slot: 1 }, value: [status] } : height,
    } as TResponse;
  };
  return createSolanaRpcFromTransport(transport);
}
describe('transaction observations', () => {
  it('separates provisional confirmation from finality', async () => {
    expect(
      await observeTransaction(rpc({ err: null, confirmationStatus: 'confirmed' }), pending),
    ).toBe('provisional');
    expect(
      await observeTransaction(rpc({ err: null, confirmationStatus: 'finalized' }), pending),
    ).toBe('finalized');
  });
  it('requires chain evidence for a failure and retains unknown expired outcomes', async () => {
    expect(
      await observeTransaction(
        rpc({ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'finalized' }),
        pending,
      ),
    ).toBe('failed');
    expect(
      await observeTransaction(
        rpc({ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'confirmed' }),
        pending,
      ),
    ).toBe('provisional');
    expect(await observeTransaction(rpc(null), pending)).toBe('pending');
    expect(await observeTransaction(rpc(null, 101), pending)).toBe('unresolved');
  });
});

it('checks the latest wallet context before requesting a signature', async () => {
  const events: string[] = [];
  const transport: RpcTransport = async <TResponse>() => {
    events.push('blockhash');
    return {
      jsonrpc: '2.0',
      id: 1,
      result: {
        context: { slot: 1 },
        value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 },
      },
    } as TResponse;
  };
  const signer = {
    address: address('11111111111111111111111111111111'),
    signTransactions: async () => {
      events.push('signature');
      return [];
    },
  };
  await expect(
    prepareTransaction(createSolanaRpcFromTransport(transport), signer, [], async () => {
      events.push('context');
      throw new Error('Wallet changed');
    }),
  ).rejects.toThrow('Wallet changed');
  expect(events).toEqual(['blockhash', 'context']);
});

describe('reviewed transaction signing boundary', () => {
  const originalBlockhash = blockhash('11111111111111111111111111111111');
  const instructions = [
    { programAddress: address('11111111111111111111111111111111'), data: new Uint8Array([0]) },
  ];
  async function setup() {
    const owner = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(18));
    const requests: string[] = [];
    const transport: RpcTransport = async <TResponse>({ payload }: Parameters<RpcTransport>[0]) => {
      const { method } = payload as { method: string };
      requests.push(method);
      if (method !== 'getLatestBlockhash') throw new Error(`Unexpected RPC method: ${method}`);
      return {
        jsonrpc: '2.0',
        id: 1,
        result: {
          context: { slot: 1 },
          value: { blockhash: originalBlockhash, lastValidBlockHeight: 100 },
        },
      } as TResponse;
    };
    return { owner, requests, rpc: createSolanaRpcFromTransport(transport) };
  }

  it('preserves the reviewed message and expiry for an ordinary wallet signature', async () => {
    const { owner, requests, rpc } = await setup();
    let reviewedBytes: Uint8Array | undefined;
    const signer: TransactionModifyingSigner = {
      address: owner.address,
      modifyAndSignTransactions: async (transactions) => {
        reviewedBytes = new Uint8Array(transactions[0]!.messageBytes);
        return Promise.all(
          transactions.map((transaction) => {
            assertIsTransactionWithBlockhashLifetime(transaction);
            assertIsTransactionWithinSizeLimit(transaction);
            return signTransaction([owner.keyPair], transaction);
          }),
        );
      },
    };
    const prepared = await prepareTransaction(rpc, signer, instructions);
    const signed = getTransactionDecoder().decode(getBase64Encoder().encode(prepared.encoded));
    expect(signed.messageBytes).toEqual(reviewedBytes);
    expect(prepared.blockhash).toBe(originalBlockhash);
    expect(prepared.lastValidBlockHeight).toBe('100');
    expect(requests).toEqual(['getLatestBlockhash']);
  });

  it.each(['instructions', 'blockhash'] as const)(
    'rejects a wallet changing %s even when the replacement signature is valid',
    async (mutation) => {
      const { owner, requests, rpc } = await setup();
      const signer: TransactionModifyingSigner = {
        address: owner.address,
        modifyAndSignTransactions: async () => {
          const replacement = pipe(
            createTransactionMessage({ version: 'legacy' }),
            (message) => setTransactionMessageFeePayer(owner.address, message),
            (message) =>
              setTransactionMessageLifetimeUsingBlockhash(
                {
                  blockhash:
                    mutation === 'blockhash' ? blockhash(owner.address) : originalBlockhash,
                  lastValidBlockHeight: mutation === 'blockhash' ? 200n : 100n,
                },
                message,
              ),
            (message) =>
              appendTransactionMessageInstructions(
                mutation === 'instructions'
                  ? [{ ...instructions[0]!, data: new Uint8Array([1]) }]
                  : instructions,
                message,
              ),
          );
          const transaction = compileTransaction(replacement);
          assertIsTransactionWithinSizeLimit(transaction);
          return [await signTransaction([owner.keyPair], transaction)];
        },
      };
      await expect(prepareTransaction(rpc, signer, instructions)).rejects.toThrow(
        'Wallet changed the reviewed transaction',
      );
      expect(requests).toEqual(['getLatestBlockhash']);
    },
  );
});

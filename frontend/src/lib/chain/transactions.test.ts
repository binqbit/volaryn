import { describe, expect, it } from 'vitest';
import { address, createSolanaRpcFromTransport, type RpcTransport } from '@solana/kit';
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

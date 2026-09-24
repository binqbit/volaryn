import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerWallet,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
} from '@wallet-standard/core';
import type { SolanaSignTransactionFeature } from '@solana/wallet-standard-features';
import {
  blockhash,
  compileTransaction,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import recipe from '../../../tests/fixtures/recipe.json' with { type: 'json' };
import { requestDemoSignature } from './approval';
import { registerDemoWallet } from './wallet';

vi.mock('@wallet-standard/core', () => ({ registerWallet: vi.fn() }));
vi.mock('./approval', () => ({ requestDemoSignature: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

async function setup() {
  const holder = await createKeyPairSignerFromPrivateKeyBytes(
    new Uint8Array(32).fill(recipe.seeds.holder),
  );
  const writer = await createKeyPairSignerFromPrivateKeyBytes(
    new Uint8Array(32).fill(recipe.seeds.writer),
  );
  await registerDemoWallet({
    mode: 'localnet',
    localnet: {
      fixtureVersion: recipe.version,
      holder: holder.address,
      writer: writer.address,
      holderUsdc: holder.address,
      writerUsdc: writer.address,
    },
  });
  const wallet = vi
    .mocked(registerWallet)
    .mock.calls.flat()
    .find((value) => value.name === 'Test Wallet 1')!;
  const connect = wallet.features['standard:connect'] as StandardConnectFeature['standard:connect'];
  const disconnect = wallet.features[
    'standard:disconnect'
  ] as StandardDisconnectFeature['standard:disconnect'];
  const signing = wallet.features[
    'solana:signTransaction'
  ] as SolanaSignTransactionFeature['solana:signTransaction'];
  const { accounts } = await connect.connect();
  const transaction = compileTransaction(
    pipe(
      createTransactionMessage({ version: 'legacy' }),
      (message) => setTransactionMessageFeePayer(holder.address, message),
      (message) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash('11111111111111111111111111111111'),
            lastValidBlockHeight: 100n,
          },
          message,
        ),
    ),
  );
  return {
    holder,
    disconnect: () => disconnect.disconnect(),
    sign: signing.signTransaction,
    input: {
      account: accounts[0]!,
      chain: 'solana:localnet' as const,
      transaction: new Uint8Array(getTransactionEncoder().encode(transaction)),
    },
  };
}

function holdApproval() {
  let approve!: () => void;
  vi.mocked(requestDemoSignature).mockImplementation(
    (_name, _address, signal) =>
      new Promise<void>((resolve, reject) => {
        approve = resolve;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  return () => approve();
}

describe('local test wallet signing', () => {
  it('waits for explicit approval and signs exactly the transaction presented', async () => {
    const { holder, sign, input } = await setup();
    const approve = holdApproval();
    const original = getTransactionDecoder().decode(new Uint8Array(input.transaction));
    let finished = false;
    const pending = sign(input).then((value) => {
      finished = true;
      return value;
    });
    expect(requestDemoSignature).toHaveBeenCalledExactlyOnceWith(
      'Test Wallet 1',
      holder.address,
      expect.any(AbortSignal),
    );
    await Promise.resolve();
    expect(finished).toBe(false);
    // A caller cannot replace the pending bytes while approval is open.
    input.transaction.fill(0);
    approve();
    const [result] = await pending;
    const signed = getTransactionDecoder().decode(result!.signedTransaction);
    expect(signed.messageBytes).toEqual(original.messageBytes);
    expect(
      await crypto.subtle.verify(
        'Ed25519',
        holder.keyPair.publicKey,
        new Uint8Array(signed.signatures[holder.address]!),
        new Uint8Array(signed.messageBytes),
      ),
    ).toBe(true);
  });

  it('propagates cancellation without a signed result and permits another request', async () => {
    const { sign, input } = await setup();
    vi.mocked(requestDemoSignature).mockRejectedValueOnce(
      new Error('Signing cancelled. No transaction was sent.'),
    );
    await expect(sign(input)).rejects.toThrow('Signing cancelled');
    vi.mocked(requestDemoSignature).mockResolvedValueOnce(undefined);
    await expect(sign(input)).resolves.toHaveLength(1);
  });

  it('rejects simultaneous requests instead of opening a second approval', async () => {
    const { sign, input } = await setup();
    const approve = holdApproval();
    const first = sign(input);
    await expect(sign(input)).rejects.toThrow('A signature request is already open');
    expect(requestDemoSignature).toHaveBeenCalledTimes(1);
    approve();
    await expect(first).resolves.toHaveLength(1);
  });

  it('aborts approval on disconnect without returning a signature', async () => {
    const { sign, input, disconnect } = await setup();
    holdApproval();
    const pending = expect(sign(input)).rejects.toThrow(
      'Wallet disconnected before signing completed',
    );
    const signal = vi.mocked(requestDemoSignature).mock.calls[0]![2];
    await disconnect();
    await pending;
    expect(signal.aborted).toBe(true);
    await expect(sign(input)).rejects.toThrow('Wallet disconnected');
    expect(requestDemoSignature).toHaveBeenCalledTimes(1);
  });

  it('does not sign when approval and disconnect race', async () => {
    const { sign, input, disconnect } = await setup();
    const approve = holdApproval();
    const pending = expect(sign(input)).rejects.toThrow(
      'Wallet disconnected before signing completed',
    );
    approve();
    await disconnect();
    await pending;
  });

  it('rejects mismatched networks and accounts before approval', async () => {
    const { sign, input } = await setup();
    await expect(sign({ ...input, chain: 'solana:mainnet' })).rejects.toThrow(
      'Wallet/network mismatch',
    );
    await expect(
      sign({
        ...input,
        account: { ...input.account, address: '11111111111111111111111111111111' },
      }),
    ).rejects.toThrow('Wallet/network mismatch');
    expect(requestDemoSignature).not.toHaveBeenCalled();
  });
});

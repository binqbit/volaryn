import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { registerDemoWallet } from './wallet';

vi.mock('@wallet-standard/core', () => ({ registerWallet: vi.fn() }));

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

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

function holdSigning() {
  const original = crypto.subtle.sign.bind(crypto.subtle);
  let notifyStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(crypto.subtle, 'sign').mockImplementation(async (...args) => {
    notifyStarted();
    await pending;
    return original(...args);
  });
  return { started, finish };
}

describe('local test wallet signing', () => {
  it('signs exactly the requested transaction without a second approval', async () => {
    const signing = vi.spyOn(crypto.subtle, 'sign');
    const { holder, sign, input } = await setup();
    const original = getTransactionDecoder().decode(new Uint8Array(input.transaction));
    expect(signing).not.toHaveBeenCalled();
    const pending = sign(input);
    // A caller cannot replace the bytes while the cryptographic operation is in progress.
    input.transaction.fill(0);
    const [result] = await pending;
    expect(signing).toHaveBeenCalledTimes(1);
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

  it('propagates a signing failure and permits another request', async () => {
    const { sign, input } = await setup();
    vi.spyOn(crypto.subtle, 'sign').mockRejectedValueOnce(new Error('Signing unavailable'));
    await expect(sign(input)).rejects.toThrow();
    await expect(sign(input)).resolves.toHaveLength(1);
  });

  it('rejects simultaneous signature requests', async () => {
    const { sign, input } = await setup();
    const signing = holdSigning();
    const first = sign(input);
    try {
      await expect(sign(input)).rejects.toThrow('A signature request is already in progress');
      // Public-key export is asynchronous; rejection need not wait for signing to start.
      await signing.started;
      expect(crypto.subtle.sign).toHaveBeenCalledTimes(1);
    } finally {
      signing.finish();
      await expect(first).resolves.toHaveLength(1);
    }
  });

  it('aborts pending signing on disconnect without returning a signature', async () => {
    const { sign, input, disconnect } = await setup();
    const signing = holdSigning();
    const pending = expect(sign(input)).rejects.toThrow(
      'Wallet disconnected before signing completed',
    );
    try {
      await signing.started;
      await disconnect();
    } finally {
      signing.finish();
      await pending;
    }
    await expect(sign(input)).rejects.toThrow('Wallet disconnected');
    expect(crypto.subtle.sign).toHaveBeenCalledTimes(1);
  });

  it('does not return a signature when signing completion and disconnect race', async () => {
    const { sign, input, disconnect } = await setup();
    const signing = holdSigning();
    const pending = expect(sign(input)).rejects.toThrow(
      'Wallet disconnected before signing completed',
    );
    await signing.started;
    signing.finish();
    await disconnect();
    await pending;
  });

  it('rejects mismatched networks and accounts before signing', async () => {
    const { sign, input } = await setup();
    const signing = vi.spyOn(crypto.subtle, 'sign');
    await expect(sign({ ...input, chain: 'solana:mainnet' })).rejects.toThrow(
      'Wallet/network mismatch',
    );
    await expect(
      sign({
        ...input,
        account: { ...input.account, address: '11111111111111111111111111111111' },
      }),
    ).rejects.toThrow('Wallet/network mismatch');
    expect(signing).not.toHaveBeenCalled();
  });
});

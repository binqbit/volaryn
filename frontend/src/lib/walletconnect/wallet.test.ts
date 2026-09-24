import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  partiallySignTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  signatureBytes,
} from '@solana/kit';
import type { StandardConnectFeature, StandardDisconnectFeature } from '@wallet-standard/core';
import type { SolanaSignTransactionFeature } from '@solana/wallet-standard-features';
import {
  createWalletConnectWallet,
  WALLETCONNECT_MAINNET,
  type WalletConnectClient,
} from './wallet';

type Session = ReturnType<WalletConnectClient['session']['get']>;
let holder: Awaited<ReturnType<typeof createKeyPairSignerFromPrivateKeyBytes>>;
let writer: typeof holder;
beforeAll(async () => {
  holder = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(18));
  writer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(19));
});
const config = {
  projectId: 'public-project-id',
  url: 'https://volaryn.example',
  icon: '/volaryn.svg',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function session(topic = 'session', addresses = [holder.address]): Session {
  const metadata = { name: 'Wallet', description: '', url: 'https://wallet.example', icons: [] };
  return {
    topic,
    pairingTopic: 'pairing',
    relay: { protocol: 'irn' },
    expiry: Math.floor(Date.now() / 1000) + 3600,
    acknowledged: true,
    controller: 'wallet',
    namespaces: {
      solana: {
        accounts: addresses.map((value) => `${WALLETCONNECT_MAINNET}:${value}`),
        methods: ['solana_signTransaction'],
        events: [],
      },
    },
    requiredNamespaces: {},
    optionalNamespaces: {},
    self: { publicKey: 'app', metadata },
    peer: { publicKey: 'wallet', metadata },
  };
}

function setup(restored: Session[] = []) {
  const approval = deferred<Session>();
  const sdk = {
    connect: vi.fn<WalletConnectClient['connect']>().mockResolvedValue({
      uri: 'wc:pairing@2?relay-protocol=irn&symKey=test',
      approval: () => approval.promise,
    }),
    disconnect: vi.fn<WalletConnectClient['disconnect']>().mockResolvedValue(undefined),
    request: vi.fn<WalletConnectClient['request']>(),
    on: vi.fn<WalletConnectClient['on']>(),
    session: {
      getAll: vi.fn(() => restored),
      get: vi.fn((topic: string) => restored.find((value) => value.topic === topic)!),
    },
  };
  const client: WalletConnectClient = {
    ...sdk,
    on: sdk.on as WalletConnectClient['on'],
    request: sdk.request as WalletConnectClient['request'],
  };
  const initialize = vi.fn().mockResolvedValue(client);
  const adapter = createWalletConnectWallet(config, initialize);
  const features = adapter.wallet.features as StandardConnectFeature &
    StandardDisconnectFeature &
    SolanaSignTransactionFeature;
  const emit = (name: Parameters<WalletConnectClient['on']>[0], event: unknown) => {
    const callback = sdk.on.mock.calls.find(([key]) => key === name)?.[1];
    (callback as (value: unknown) => void)?.(event);
  };
  return {
    ...adapter,
    sdk,
    client,
    initialize,
    approval,
    emit,
    connect: features['standard:connect'].connect,
    disconnect: features['standard:disconnect'].disconnect,
    sign: features['solana:signTransaction'].signTransaction,
  };
}

function unsigned(lifetime = '11111111111111111111111111111111') {
  return compileTransaction(
    pipe(
      createTransactionMessage({ version: 'legacy' }),
      (message) => setTransactionMessageFeePayer(holder.address, message),
      (message) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: blockhash(lifetime), lastValidBlockHeight: 100n },
          message,
        ),
    ),
  );
}

async function signingSetup() {
  const adapter = setup([session()]);
  await adapter.connect({ silent: true });
  const transaction = unsigned();
  const signed = await signTransaction([holder.keyPair], transaction);
  return {
    ...adapter,
    transaction,
    signed,
    input: {
      account: adapter.wallet.accounts[0]!,
      chain: 'solana:mainnet' as const,
      transaction: new Uint8Array(getTransactionEncoder().encode(transaction)),
    },
    response: {
      signature: getBase58Decoder().decode(signed.signatures[holder.address]!),
      transaction: getBase64Decoder().decode(getTransactionEncoder().encode(signed)),
    },
  };
}

describe('WalletConnect connection lifecycle', () => {
  it('initializes lazily and silently returns no accounts without opening a pairing', async () => {
    const adapter = setup();
    expect(adapter.initialize).not.toHaveBeenCalled();
    const snapshot = adapter.getSnapshot();
    await expect(adapter.connect({ silent: true })).resolves.toEqual({ accounts: [] });
    expect(adapter.sdk.connect).not.toHaveBeenCalled();
    expect(adapter.getSnapshot()).toBe(snapshot);
  });

  it('bounds silent restoration and ignores SDK initialization that finishes after timeout', async () => {
    vi.useFakeTimers();
    try {
      const adapter = setup([session()]);
      const initialized = deferred<WalletConnectClient>();
      adapter.initialize.mockReturnValueOnce(initialized.promise);
      const restored = adapter.connect({ silent: true });
      await vi.advanceTimersByTimeAsync(5000);
      await expect(restored).resolves.toEqual({ accounts: [] });
      initialized.resolve(adapter.client);
      await initialized.promise;
      await Promise.resolve();
      expect(adapter.wallet.accounts).toEqual([]);
      expect(adapter.sdk.connect).not.toHaveBeenCalled();
      await adapter.connect();
      expect(adapter.wallet.accounts[0]!.address).toBe(holder.address);
      expect(adapter.initialize).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores approved mainnet accounts and excludes expired or incompatible sessions', async () => {
    const expired = { ...session('expired'), expiry: 1 };
    const devnet = session('devnet');
    devnet.namespaces.solana!.accounts = [
      `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:${holder.address}`,
    ];
    const unsupported = session('unsupported');
    unsupported.namespaces.solana!.methods = ['solana_signMessage'];
    const adapter = setup([expired, devnet, unsupported, session('valid')]);
    await adapter.connect({ silent: true });
    expect(adapter.wallet.accounts.map((account) => account.address)).toEqual([holder.address]);
    expect(adapter.wallet.accounts[0]!.chains).toEqual(['solana:mainnet']);
    expect(adapter.sdk.connect).not.toHaveBeenCalled();
  });

  it('shows the SDK pairing URI and connects only after approval', async () => {
    const adapter = setup();
    const changed = vi.fn();
    adapter.subscribe(changed);
    const pending = adapter.connect();
    await vi.waitFor(() => expect(adapter.getSnapshot().uri).toMatch(/^wc:/));
    expect(adapter.wallet.accounts).toEqual([]);
    const snapshot = adapter.getSnapshot();
    expect(adapter.getSnapshot()).toBe(snapshot);
    adapter.approval.resolve(session());
    await pending;
    expect(adapter.wallet.accounts[0]!.address).toBe(holder.address);
    expect(adapter.getSnapshot().uri).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(adapter.sdk.connect).toHaveBeenCalledWith({
      optionalNamespaces: {
        solana: {
          chains: [WALLETCONNECT_MAINNET],
          methods: ['solana_signTransaction'],
          events: [],
        },
      },
    });
  });

  it('clears a rejected pairing and permits retry', async () => {
    const adapter = setup();
    const rejected = expect(adapter.connect()).rejects.toThrow('User rejected');
    await vi.waitFor(() => expect(adapter.getSnapshot().uri).toBeDefined());
    adapter.approval.reject(new Error('User rejected'));
    await rejected;
    expect(adapter.getSnapshot().uri).toBeUndefined();
    adapter.sdk.connect.mockResolvedValueOnce({ approval: async () => session() });
    await adapter.connect();
    expect(adapter.wallet.accounts[0]!.address).toBe(holder.address);
  });

  it('cancels immediately and discards a late approval without reconnecting', async () => {
    const adapter = setup();
    const cancelled = expect(adapter.connect()).rejects.toThrow('connection cancelled');
    await vi.waitFor(() => expect(adapter.getSnapshot().uri).toBeDefined());
    adapter.cancelPairing();
    await cancelled;
    expect(adapter.wallet.accounts).toEqual([]);
    expect(adapter.getSnapshot().uri).toBeUndefined();
    expect(adapter.sdk.disconnect).toHaveBeenCalledWith({
      topic: 'pairing',
      reason: { code: 6000, message: 'User disconnected' },
    });
    adapter.approval.resolve(session('late'));
    await vi.waitFor(() =>
      expect(adapter.sdk.disconnect).toHaveBeenCalledWith({
        topic: 'late',
        reason: { code: 6000, message: 'User disconnected' },
      }),
    );
    expect(adapter.wallet.accounts).toEqual([]);
  });

  it('cancellation during SDK initialization cannot open a pairing later', async () => {
    const adapter = setup();
    const initialized = deferred<WalletConnectClient>();
    adapter.initialize.mockReturnValueOnce(initialized.promise);
    const cancelled = expect(adapter.connect()).rejects.toThrow('connection cancelled');
    adapter.cancelPairing();
    await cancelled;
    initialized.resolve(adapter.client);
    await initialized.promise;
    await Promise.resolve();
    expect(adapter.sdk.connect).not.toHaveBeenCalled();
  });

  it('follows session account updates and disconnect events only for its active session', async () => {
    const stored = [session()];
    const adapter = setup(stored);
    await adapter.connect({ silent: true });
    adapter.emit('session_delete', { topic: 'unrelated' });
    expect(adapter.wallet.accounts).toHaveLength(1);
    stored[0] = session('session', [writer.address]);
    adapter.emit('session_update', {
      topic: 'session',
      params: { namespaces: stored[0].namespaces },
    });
    expect(adapter.wallet.accounts[0]!.address).toBe(writer.address);
    adapter.emit('session_delete', { topic: 'session' });
    expect(adapter.wallet.accounts).toEqual([]);
  });

  it('tracks account selection among approved accounts and clears expired sessions', async () => {
    const adapter = setup([session('session', [holder.address, writer.address])]);
    await adapter.connect({ silent: true });
    adapter.emit('session_event', {
      topic: 'session',
      params: { event: { name: 'accountsChanged', data: [writer.address] } },
    });
    expect(adapter.wallet.accounts.map((account) => account.address)).toEqual([writer.address]);
    adapter.emit('session_event', {
      topic: 'session',
      params: { event: { name: 'accountsChanged', data: [holder.address] } },
    });
    expect(adapter.wallet.accounts.map((account) => account.address)).toEqual([holder.address]);
    adapter.emit('session_expire', { topic: 'session' });
    expect(adapter.wallet.accounts).toEqual([]);
  });

  it('does not restore an explicitly disconnected session if relay cleanup fails', async () => {
    const adapter = setup([session()]);
    await adapter.connect({ silent: true });
    adapter.sdk.disconnect.mockRejectedValueOnce(new Error('Relay offline'));
    await expect(adapter.disconnect()).rejects.toThrow('Relay offline');
    await expect(adapter.connect({ silent: true })).resolves.toEqual({ accounts: [] });
    expect(adapter.sdk.connect).not.toHaveBeenCalled();
  });

  it('rejects a session that omits mainnet signing instead of advertising an unusable account', async () => {
    const adapter = setup();
    const declined = session();
    declined.namespaces.solana!.methods = [];
    adapter.approval.resolve(declined);
    await expect(adapter.connect()).rejects.toThrow('did not approve Solana mainnet');
    expect(adapter.wallet.accounts).toEqual([]);
    expect(adapter.sdk.disconnect).toHaveBeenCalled();
  });
});

describe('WalletConnect transaction signing', () => {
  it.each(['signature', 'transaction'] as const)(
    'accepts a valid %s response and preserves transaction bytes',
    async (kind) => {
      const adapter = await signingSetup();
      adapter.sdk.request.mockResolvedValue({ [kind]: adapter.response[kind] });
      const pending = adapter.sign(adapter.input);
      adapter.input.transaction.fill(0);
      const [result] = await pending;
      const signed = getTransactionDecoder().decode(result!.signedTransaction);
      expect(signed.messageBytes).toEqual(adapter.signed.messageBytes);
      expect(signed.signatures).toEqual(adapter.signed.signatures);
      const request = adapter.sdk.request.mock.calls[0]![0];
      expect(request.chainId).toBe(WALLETCONNECT_MAINNET);
      const payload = request.request.params as { transaction: string };
      expect(getBase64Encoder().encode(payload.transaction)).toEqual(
        getTransactionEncoder().encode(adapter.transaction),
      );
    },
  );

  it('rejects changed transaction messages even with a valid wallet signature', async () => {
    const adapter = await signingSetup();
    const changed = await signTransaction([holder.keyPair], unsigned(writer.address));
    adapter.sdk.request.mockResolvedValue({
      transaction: getBase64Decoder().decode(getTransactionEncoder().encode(changed)),
    });
    await expect(adapter.sign(adapter.input)).rejects.toThrow('Wallet changed the transaction');
  });

  it('rejects invalid signatures and allows the next request', async () => {
    const adapter = await signingSetup();
    adapter.sdk.request.mockResolvedValueOnce({
      signature: getBase58Decoder().decode(new Uint8Array(64)),
    });
    await expect(adapter.sign(adapter.input)).rejects.toThrow('invalid signature');
    adapter.sdk.request.mockResolvedValueOnce(adapter.response);
    await expect(adapter.sign(adapter.input)).resolves.toHaveLength(1);
  });

  it('preserves a second signer on a versioned transaction and rejects its replacement', async () => {
    const adapter = await signingSetup();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (value) => setTransactionMessageFeePayer(holder.address, value),
      (value) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash('11111111111111111111111111111111'),
            lastValidBlockHeight: 100n,
          },
          value,
        ),
      (value) =>
        appendTransactionMessageInstruction(
          {
            programAddress: address('11111111111111111111111111111111'),
            accounts: [{ address: writer.address, role: AccountRole.READONLY_SIGNER }],
          },
          value,
        ),
    );
    const partiallySigned = await partiallySignTransaction(
      [writer.keyPair],
      compileTransaction(message),
    );
    const fullySigned = await signTransaction([holder.keyPair], partiallySigned);
    const input = {
      ...adapter.input,
      transaction: new Uint8Array(getTransactionEncoder().encode(partiallySigned)),
    };
    adapter.sdk.request.mockResolvedValueOnce({
      signature: getBase58Decoder().decode(fullySigned.signatures[holder.address]!),
    });
    const [result] = await adapter.sign(input);
    expect(getTransactionDecoder().decode(result!.signedTransaction).signatures).toEqual(
      fullySigned.signatures,
    );
    const replaced = {
      ...fullySigned,
      signatures: {
        ...fullySigned.signatures,
        [writer.address]: signatureBytes(new Uint8Array(64)),
      },
    };
    adapter.sdk.request.mockResolvedValueOnce({
      transaction: getBase64Decoder().decode(getTransactionEncoder().encode(replaced)),
    });
    await expect(adapter.sign(input)).rejects.toThrow('changed an existing signature');
  });

  it('rejects mismatched networks and accounts before contacting the wallet', async () => {
    const adapter = await signingSetup();
    await expect(adapter.sign({ ...adapter.input, chain: 'solana:localnet' })).rejects.toThrow(
      'Wallet/network mismatch',
    );
    await expect(
      adapter.sign({
        ...adapter.input,
        account: { ...adapter.input.account, address: writer.address },
      }),
    ).rejects.toThrow('Wallet/network mismatch');
    expect(adapter.sdk.request).not.toHaveBeenCalled();
  });

  it('rejects concurrent signing and cannot return a signature after session disconnect', async () => {
    const adapter = await signingSetup();
    const response = deferred<unknown>();
    adapter.sdk.request.mockReturnValueOnce(response.promise);
    const pending = expect(adapter.sign(adapter.input)).rejects.toThrow(
      'changed before signing completed',
    );
    await expect(adapter.sign(adapter.input)).rejects.toThrow('already in progress');
    await adapter.disconnect();
    response.resolve(adapter.response);
    await pending;
    expect(adapter.wallet.accounts).toEqual([]);
  });
});

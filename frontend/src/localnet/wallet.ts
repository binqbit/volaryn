import {
  registerWallet,
  type Wallet,
  type WalletAccount,
  type StandardEventsListeners,
} from '@wallet-standard/core';
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
  signTransaction,
} from '@solana/kit';
import type { SolanaSignTransactionFeature } from '@solana/wallet-standard-features';
import type { Deployment } from '../lib/api/client';
import recipe from '../../../tests/fixtures/recipe.json' with { type: 'json' };

export async function registerDemoWallet(deployment: Pick<Deployment, 'mode' | 'localnet'>) {
  if (deployment.mode !== 'localnet' || deployment.localnet?.fixtureVersion !== recipe.version)
    throw new Error('Demo wallet requires the local fixture deployment');
  await Promise.all([
    registerParticipant(deployment.localnet.holder, recipe.seeds.holder, 'Test Wallet 1'),
    registerParticipant(deployment.localnet.writer, recipe.seeds.writer, 'Test Wallet 2'),
  ]);
}

async function registerParticipant(expected: string, seed: number, name: string) {
  const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(seed));
  if (signer.address !== expected) throw new Error('Demo identity does not match the ledger');
  const account: WalletAccount = {
    address: signer.address,
    publicKey: new Uint8Array(getAddressEncoder().encode(signer.address)),
    chains: ['solana:localnet'],
    features: ['solana:signTransaction'],
    label: name,
  };
  let accounts: readonly WalletAccount[] = [];
  let signingRequest: AbortController | undefined;
  const listeners = new Set<StandardEventsListeners['change']>();
  const emit = () => {
    for (const listener of listeners) listener({ accounts });
  };
  const signing: SolanaSignTransactionFeature['solana:signTransaction'] = {
    version: '1.0.0',
    supportedTransactionVersions: ['legacy'],
    signTransaction: async (...inputs) => {
      if (!accounts.length) throw new Error('Wallet disconnected');
      if (signingRequest)
        throw new Error('A signature request is already in progress for this wallet');
      const controller = new AbortController();
      signingRequest = controller;
      try {
        const output = [];
        for (const input of inputs) {
          if (input.account.address !== signer.address || input.chain !== 'solana:localnet')
            throw new Error('Wallet/network mismatch');
          const transaction = getTransactionDecoder().decode(new Uint8Array(input.transaction));
          // The application's terms review is the approval for this disposable local signer.
          controller.signal.throwIfAborted();
          const signed = await signTransaction([signer.keyPair], transaction);
          controller.signal.throwIfAborted();
          output.push({
            signedTransaction: new Uint8Array(getTransactionEncoder().encode(signed)),
          });
        }
        return output;
      } finally {
        signingRequest = undefined;
      }
    },
  };
  const wallet: Wallet = {
    version: '1.0.0',
    name,
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iIzFiNmQ1YSIvPjxwYXRoIGQ9Ik04IDEwbDggMTIgOC0xMiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIzIi8+PC9zdmc+',
    chains: ['solana:localnet'],
    get accounts() {
      return accounts;
    },
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async () => {
          accounts = [account];
          emit();
          return { accounts };
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          accounts = [];
          signingRequest?.abort(new Error('Wallet disconnected before signing completed'));
          emit();
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (event: 'change', listener: StandardEventsListeners['change']) => {
          if (event !== 'change') throw new Error('Unsupported wallet event');
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      'solana:signTransaction': signing,
    },
  };
  registerWallet(wallet);
}

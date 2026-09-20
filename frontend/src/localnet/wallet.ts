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

export async function registerDemoWallet(deployment: Deployment) {
  if (deployment.mode !== 'localnet' || deployment.fixtureVersion !== recipe.version)
    throw new Error('Demo wallet requires the local fixture deployment');
  const signer = await createKeyPairSignerFromPrivateKeyBytes(
    new Uint8Array(32).fill(recipe.seeds.holder),
  );
  if (signer.address !== deployment.holder)
    throw new Error('Demo identity does not match the ledger');
  const account: WalletAccount = {
    address: signer.address,
    publicKey: new Uint8Array(getAddressEncoder().encode(signer.address)),
    chains: ['solana:localnet'],
    features: ['solana:signTransaction'],
    label: 'Local test holder',
  };
  let accounts: readonly WalletAccount[] = [];
  const listeners = new Set<StandardEventsListeners['change']>();
  const emit = () => {
    for (const listener of listeners) listener({ accounts });
  };
  const signing: SolanaSignTransactionFeature['solana:signTransaction'] = {
    version: '1.0.0',
    supportedTransactionVersions: ['legacy'],
    signTransaction: async (...inputs) => {
      if (!accounts.length) throw new Error('Wallet disconnected');
      const output = [];
      for (const input of inputs) {
        if (input.account.address !== signer.address || input.chain !== 'solana:localnet')
          throw new Error('Wallet/network mismatch');
        if (
          !window.confirm(
            'Sign this local test transaction? Only disposable test assets are involved.',
          )
        )
          throw new Error('Signature rejected by wallet');
        const signed = await signTransaction(
          [signer.keyPair],
          getTransactionDecoder().decode(input.transaction),
        );
        output.push({ signedTransaction: new Uint8Array(getTransactionEncoder().encode(signed)) });
      }
      return output;
    },
  };
  const wallet: Wallet = {
    version: '1.0.0',
    name: 'Local test wallet',
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

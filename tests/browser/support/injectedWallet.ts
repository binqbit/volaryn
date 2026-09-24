import type { Page } from '@playwright/test';
import { getAddressEncoder, address } from '@solana/kit';
import type {
  StandardEventsListeners,
  Wallet,
  WalletAccount,
  WindowAppReadyEventAPI,
} from '@wallet-standard/core';

interface InjectedWalletOptions {
  address: string;
  name?: string;
  chains?: `solana:${string}`[];
  deferred?: boolean;
  rejection?: string;
  registerAfterLoad?: boolean;
}

declare global {
  interface Window {
    __volarynWalletFixture: {
      approve: () => Promise<void>;
      register: () => void;
      stats: {
        connects: number;
        completedConnects: number;
        disconnects: number;
        signatures: number;
      };
    };
  }
}

/** A browser wallet extension fixture using the public Wallet Standard registration events. */
export async function injectWallet(page: Page, options: InjectedWalletOptions) {
  await page.addInitScript(
    ({ options, publicKey }) => {
      const name = options.name ?? 'Phantom';
      const chains = options.chains ?? ['solana:localnet'];
      const account: WalletAccount = {
        address: options.address,
        publicKey: new Uint8Array(publicKey),
        chains,
        features: ['solana:signTransaction'],
        label: name,
      };
      const listeners = new Set<StandardEventsListeners['change']>();
      const stats = { connects: 0, completedConnects: 0, disconnects: 0, signatures: 0 };
      let accounts: readonly WalletAccount[] = [];
      let releaseApproval: (() => void) | undefined;
      let pendingConnection: Promise<{ accounts: readonly WalletAccount[] }> | undefined;
      let registrationEnabled = !options.registerAfterLoad;
      const emit = () => {
        for (const listener of listeners) listener({ accounts });
      };
      const wallet: Wallet = {
        version: '1.0.0',
        name,
        icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjNzA1MWZmIi8+PC9zdmc+',
        chains,
        get accounts() {
          return accounts;
        },
        features: {
          'standard:connect': {
            version: '1.0.0',
            connect: () => {
              pendingConnection = (async () => {
                stats.connects++;
                if (options.rejection) throw new Error(options.rejection);
                if (options.deferred)
                  await new Promise<void>((resolve) => {
                    releaseApproval = resolve;
                  });
                accounts = [account];
                emit();
                stats.completedConnects++;
                return { accounts };
              })();
              return pendingConnection;
            },
          },
          'standard:disconnect': {
            version: '1.0.0',
            disconnect: async () => {
              stats.disconnects++;
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
          'solana:signTransaction': {
            version: '1.0.0',
            supportedTransactionVersions: ['legacy'],
            signTransaction: async () => {
              stats.signatures++;
              throw new Error('Signing is forbidden in a wallet chooser test');
            },
          },
        },
      };
      const register = ({ register }: WindowAppReadyEventAPI) => {
        if (registrationEnabled) register(wallet);
      };
      const announce = () => {
        window.dispatchEvent(
          new CustomEvent('wallet-standard:register-wallet', { detail: register }),
        );
      };
      window.addEventListener('wallet-standard:app-ready', (event) => {
        register((event as CustomEvent<WindowAppReadyEventAPI>).detail);
      });
      window.__volarynWalletFixture = {
        approve: async () => {
          if (!releaseApproval) throw new Error('No wallet approval is pending');
          releaseApproval();
          await pendingConnection;
        },
        register: () => {
          registrationEnabled = true;
          announce();
        },
        stats,
      };
      if (registrationEnabled) announce();
    },
    {
      options,
      publicKey: Array.from(getAddressEncoder().encode(address(options.address))),
    },
  );
}

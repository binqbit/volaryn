import { address, getAddressEncoder, getBase64Decoder, getTransactionDecoder } from '@solana/kit';
import type { SolanaSignTransactionFeature } from '@solana/wallet-standard-features';
import type {
  StandardConnectFeature,
  StandardDisconnectFeature,
  StandardEventsFeature,
  StandardEventsListeners,
  Wallet,
  WalletAccount,
} from '@wallet-standard/core';
import type SignClient from '@walletconnect/sign-client';
import { decodeSignedTransaction } from './signing';
import { walletConnectIcon } from './icon';

export const WALLETCONNECT_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const CHAIN = 'solana:mainnet';
const METHOD = 'solana_signTransaction';
const DISCONNECTED = { code: 6000, message: 'User disconnected' };
const EMPTY_SNAPSHOT: WalletConnectSnapshot = {};

type Session = ReturnType<SignClient['session']['get']>;
export type WalletConnectClient = Pick<SignClient, 'connect' | 'request' | 'disconnect' | 'on'> & {
  session: Pick<SignClient['session'], 'getAll' | 'get'>;
};
type Config = { projectId: string; url: string; icon: string };
export type WalletConnectSnapshot = { readonly uri?: string };

async function initializeClient(config: Config): Promise<WalletConnectClient> {
  const { default: Client } = await import('@walletconnect/sign-client');
  return Client.init({
    projectId: config.projectId,
    customStoragePrefix: 'volaryn',
    metadata: {
      name: 'Volaryn',
      description: 'Volaryn wallet connection',
      url: config.url,
      icons: [new URL(config.icon, config.url).toString()],
    },
  });
}

function accountAddresses(session: Session): string[] {
  if (session.expiry * 1000 <= Date.now()) return [];
  return [
    ...new Set(
      Object.entries(session.namespaces)
        .filter(
          ([key, namespace]) =>
            (key === 'solana' || key === WALLETCONNECT_MAINNET) &&
            namespace.methods.includes(METHOD),
        )
        .flatMap(([, namespace]) => namespace.accounts)
        .filter((account) => account.startsWith(`${WALLETCONNECT_MAINNET}:`))
        .map((account) => address(account.slice(WALLETCONNECT_MAINNET.length + 1))),
    ),
  ];
}

function pairingTopic(uri: string | undefined) {
  return uri?.match(/^wc:([^@]+)@2\?/u)?.[1];
}

/** Adapts the official WalletConnect Sign SDK to the application's Wallet Standard signer. */
export function createWalletConnectWallet(
  config: Config,
  initialize: (config: Config) => Promise<WalletConnectClient> = initializeClient,
) {
  let client: WalletConnectClient | undefined;
  let initialization: Promise<WalletConnectClient> | undefined;
  let session: Session | undefined;
  let accounts: readonly WalletAccount[] = [];
  let snapshot = EMPTY_SNAPSHOT;
  let revision = 0;
  let signing = false;
  const listeners = new Set<() => void>();
  const changes = new Set<StandardEventsListeners['change']>();
  const discardedTopics = new Set<string>();
  let pairing:
    | {
        controller: AbortController;
        topic?: string;
        promise?: Promise<{ accounts: readonly WalletAccount[] }>;
      }
    | undefined;

  const setUri = (uri?: string) => {
    if (snapshot.uri === uri) return;
    snapshot = uri ? { uri } : EMPTY_SNAPSHOT;
    for (const listener of listeners) listener();
  };
  const emit = () => {
    revision++;
    for (const listener of changes) listener({ accounts });
  };
  const clearSession = () => {
    session = undefined;
    accounts = [];
    emit();
  };
  const makeAccounts = (nextAddresses: string[]): WalletAccount[] =>
    nextAddresses.map((value) => ({
      address: value,
      publicKey: new Uint8Array(getAddressEncoder().encode(address(value))),
      chains: [CHAIN],
      features: ['solana:signTransaction'],
    }));
  const adoptSession = (next: Session) => {
    const nextAddresses = accountAddresses(next);
    session = nextAddresses.length ? next : undefined;
    accounts = makeAccounts(nextAddresses);
    emit();
  };
  const discard = async (topic: string) => {
    discardedTopics.add(topic);
    // A rejected or expired pairing may already have been removed by the SDK.
    await client?.disconnect({ topic, reason: DISCONNECTED }).catch(() => undefined);
  };
  const getClient = () => {
    initialization ??= initialize(config)
      .then((value) => {
        client = value;
        value.on('session_delete', ({ topic }) => {
          if (topic === session?.topic) clearSession();
        });
        value.on('session_expire', ({ topic }) => {
          if (topic === session?.topic) clearSession();
        });
        value.on('session_update', ({ topic, params }) => {
          if (topic !== session?.topic) return;
          try {
            adoptSession({ ...value.session.get(topic), namespaces: params.namespaces });
          } catch {
            clearSession();
          }
        });
        value.on('session_event', ({ topic, params }) => {
          if (topic !== session?.topic) return;
          const { event } = params;
          if (event.name === 'accountsChanged') {
            const requested: unknown = event.data;
            const selected = Array.isArray(requested)
              ? requested.filter((item): item is string => typeof item === 'string')
              : [];
            accounts = makeAccounts(
              accountAddresses(session).filter(
                (account) =>
                  selected.includes(account) ||
                  selected.includes(`${WALLETCONNECT_MAINNET}:${account}`),
              ),
            );
            emit();
          } else if (event.name === 'chainChanged' && event.data !== WALLETCONNECT_MAINNET) {
            clearSession();
          }
        });
        return value;
      })
      .catch((error: unknown) => {
        initialization = undefined;
        throw error;
      });
    return initialization;
  };

  const cancelPairing = () => {
    if (!pairing) return;
    pairing.controller.abort(new Error('WalletConnect connection cancelled'));
    if (pairing.topic) void discard(pairing.topic);
    setUri();
  };

  const connect: StandardConnectFeature['standard:connect']['connect'] = (input) => {
    if (pairing?.promise) return pairing.promise;
    const current = { controller: new AbortController() } as NonNullable<typeof pairing>;
    pairing = current;
    const { signal } = current.controller;
    const run = async () => {
      const sdk = await getClient();
      signal.throwIfAborted();
      if (session && accounts.length && accountAddresses(session).length) return { accounts };
      if (session || accounts.length) clearSession();
      const restored = sdk.session.getAll().find((candidate) => {
        if (discardedTopics.has(candidate.topic)) return false;
        try {
          return accountAddresses(candidate).length > 0;
        } catch {
          return false;
        }
      });
      if (restored) {
        adoptSession(restored);
        return { accounts };
      }
      if (input?.silent) return { accounts };

      const proposal = await sdk.connect({
        optionalNamespaces: {
          solana: { chains: [WALLETCONNECT_MAINNET], methods: [METHOD], events: [] },
        },
      });
      current.topic = pairingTopic(proposal.uri);
      const approval = proposal.approval();
      if (signal.aborted) {
        if (current.topic) void discard(current.topic);
        void approval.then((late) => discard(late.topic)).catch(() => undefined);
        signal.throwIfAborted();
      }
      setUri(proposal.uri);
      const approved = await approval;
      if (signal.aborted) {
        await discard(approved.topic);
        signal.throwIfAborted();
      }
      if (!accountAddresses(approved).length) {
        await discard(approved.topic);
        throw new Error('The wallet did not approve Solana mainnet transaction signing');
      }
      adoptSession(approved);
      return { accounts };
    };
    let onAbort: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    let silentRestoreTimedOut = false;
    const timeout = input?.silent
      ? setTimeout(() => {
          silentRestoreTimedOut = true;
          current.controller.abort(new Error('WalletConnect session restoration timed out'));
        }, 5000)
      : undefined;
    current.promise = Promise.race([run(), cancelled])
      .catch((error: unknown) => {
        if (current.topic) void discard(current.topic);
        if (silentRestoreTimedOut) return { accounts: [] };
        throw error;
      })
      .finally(() => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        if (pairing === current) {
          pairing = undefined;
          setUri();
        }
      });
    return current.promise;
  };

  const signingFeature: SolanaSignTransactionFeature['solana:signTransaction'] = {
    version: '1.0.0',
    supportedTransactionVersions: ['legacy', 0],
    signTransaction: async (...inputs) => {
      if (!client || !session || !accounts.length) throw new Error('Wallet disconnected');
      if (signing) throw new Error('A signature request is already in progress for this wallet');
      const sdk = client;
      const active = session;
      const started = revision;
      // Own the request bytes before yielding to the remote wallet.
      const requests = inputs.map((input) => ({
        ...input,
        transaction: new Uint8Array(input.transaction),
      }));
      signing = true;
      const checkCurrent = () => {
        if (revision !== started || session?.topic !== active.topic)
          throw new Error('Wallet disconnected or changed before signing completed');
      };
      try {
        const output = [];
        for (const input of requests) {
          checkCurrent();
          if (
            input.chain !== CHAIN ||
            !accounts.includes(input.account) ||
            !accountAddresses(active).includes(input.account.address)
          )
            throw new Error('Wallet/network mismatch');
          const owner = address(input.account.address);
          const transaction = getTransactionDecoder().decode(input.transaction);
          if (!(owner in transaction.signatures))
            throw new Error('Account is not a transaction signer');
          const response = await sdk.request<unknown>({
            topic: active.topic,
            chainId: WALLETCONNECT_MAINNET,
            request: {
              method: METHOD,
              params: { transaction: getBase64Decoder().decode(input.transaction) },
            },
          });
          checkCurrent();
          const signedTransaction = await decodeSignedTransaction(transaction, owner, response);
          checkCurrent();
          output.push({ signedTransaction });
        }
        return output;
      } finally {
        signing = false;
      }
    },
  };
  const features: StandardConnectFeature &
    StandardDisconnectFeature &
    StandardEventsFeature &
    SolanaSignTransactionFeature = {
    'standard:connect': { version: '1.0.0', connect },
    'standard:disconnect': {
      version: '1.0.0',
      disconnect: async () => {
        cancelPairing();
        const topic = session?.topic;
        clearSession();
        if (topic) {
          discardedTopics.add(topic);
          await client?.disconnect({ topic, reason: DISCONNECTED });
        }
      },
    },
    'standard:events': {
      version: '1.0.0',
      on: (event, listener) => {
        if (event !== 'change') throw new Error('Unsupported wallet event');
        changes.add(listener);
        return () => changes.delete(listener);
      },
    },
    'solana:signTransaction': signingFeature,
  };
  const wallet: Wallet = {
    version: '1.0.0',
    name: 'WalletConnect',
    icon: walletConnectIcon,
    chains: [CHAIN],
    get accounts() {
      return accounts;
    },
    features,
  };
  return {
    wallet,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancelPairing,
  };
}

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from 'react';
import { useClient } from '@solana/react';
import { useWallets } from '@solana/kit-plugin-wallet/react';
import type { AppClient } from '../../lib/chain/client';
import { useRegisteredWallets } from './useRegisteredWallets';
import { WalletQr } from './WalletQr';
import { walletConnectIcon } from '../../lib/walletconnect/icon';
// Phantom's published provider icon: anza-xyz/wallet-adapter/packages/wallets/phantom.
import phantomIcon from './phantom.svg';
import styles from './WalletDialog.module.css';

const emptyPairing = { uri: undefined };
const noPairing = () => emptyPairing;
const noSubscription = () => () => {};

function outside(event: MouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false;
  const rect = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

export function WalletDialog({ onClose }: { onClose: () => void }) {
  const client = useClient<AppClient>();
  const eligible = useWallets(client);
  const registered = useRegisteredWallets();
  const pairing = useSyncExternalStore(
    client.walletConnect?.subscribe ?? noSubscription,
    client.walletConnect?.getSnapshot ?? noPairing,
    noPairing,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const attempt = useRef<symbol | null>(null);
  const pressedOutside = useRef(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState('');
  const title = useId();
  const local = import.meta.env.MODE === 'localnet';
  const chain = local ? 'solana:localnet' : 'solana:mainnet';

  const cancelPending = useCallback(() => {
    if (!attempt.current) return;
    attempt.current = null;
    // Hook cancellation alone does not invalidate a provider's late approval in Kit.
    // Supersede the plugin's connect generation before closing remote pairing.
    void Promise.allSettled([client.wallet.disconnect(), client.walletConnect?.cancelPairing()]);
  }, [client]);

  useEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => {
      cancelPending();
      element.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [cancelPending]);

  const close = () => {
    cancelPending();
    onClose();
  };
  const select = async (wallet: (typeof eligible)[number]) => {
    if (attempt.current) return;
    const token = Symbol();
    attempt.current = token;
    setPending(wallet.name);
    setError('');
    try {
      await client.wallet.connect(wallet);
      if (attempt.current !== token) return;
      attempt.current = null;
      onClose();
    } catch (cause) {
      if (attempt.current !== token) return;
      attempt.current = null;
      setPending(undefined);
      setError(cause instanceof Error ? cause.message : 'Could not connect. Please try again.');
    }
  };
  const external = registered.filter(
    (wallet) =>
      wallet.chains.some((value) => value.startsWith('solana:')) &&
      !(
        import.meta.env.MODE === 'localnet' &&
        ['Test Wallet 1', 'Test Wallet 2'].includes(wallet.name)
      ),
  );
  const testWallets =
    import.meta.env.MODE === 'localnet'
      ? eligible.filter((wallet) => ['Test Wallet 1', 'Test Wallet 2'].includes(wallet.name))
      : [];

  function row(wallet: (typeof registered)[number], index: number) {
    const choice = eligible.find((candidate) => candidate.name === wallet.name);
    const supported = choice?.features.includes('solana:signTransaction');
    const description = !wallet.chains.includes(chain)
      ? `Not available on ${local ? 'localnet' : 'Solana mainnet'}`
      : !supported
        ? 'Transaction signing is not supported'
        : wallet.name === 'WalletConnect'
          ? 'Scan with a compatible mobile wallet'
          : 'Installed wallet';
    return (
      <button
        key={wallet.name}
        type="button"
        className={styles.option}
        aria-label={`Connect ${wallet.name}`}
        aria-describedby={`${title}-provider-${index}`}
        disabled={!!pending || !supported}
        onClick={() => {
          if (choice) void select(choice);
        }}
      >
        <img src={wallet.icon} alt="" width="36" height="36" />
        <span>
          <strong>{wallet.name}</strong>
          <small id={`${title}-provider-${index}`}>
            {pending === wallet.name ? 'Waiting for approval…' : description}
          </small>
        </span>
        <span className={styles.trailing} aria-hidden="true">
          {pending === wallet.name ? '…' : supported ? '→' : '—'}
        </span>
      </button>
    );
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => {
        pressedOutside.current = outside(event);
      }}
      onClick={(event) => {
        if (pressedOutside.current && outside(event)) close();
      }}
    >
      <div className={styles.heading}>
        <div>
          <span className={styles.network}>
            {local ? 'Localnet · test funds' : 'Solana mainnet'}
          </span>
          <h2 id={title}>Connect wallet</h2>
        </div>
        <button type="button" className={styles.close} aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      <p className={styles.intro}>Choose how to connect. Transactions always need your approval.</p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {pending && (
        <p className={styles.pending} role="status">
          Approve the connection in {pending}, or close this window to cancel.
        </p>
      )}
      {pairing.uri ? (
        <WalletQr uri={pairing.uri} />
      ) : (
        <>
          <div className={styles.options}>
            {external.map(row)}
            {!external.some((wallet) => wallet.name === 'Phantom') &&
              (local ? (
                <button
                  type="button"
                  className={styles.option}
                  aria-label="Connect Phantom"
                  aria-describedby={`${title}-phantom`}
                  disabled
                >
                  <img src={phantomIcon} alt="" width="36" height="36" />
                  <span>
                    <strong>Phantom</strong>
                    <small id={`${title}-phantom`}>Not available on localnet</small>
                  </span>
                  <span className={styles.trailing} aria-hidden="true">
                    —
                  </span>
                </button>
              ) : (
                <a
                  className={styles.option}
                  href="https://phantom.com/download"
                  target="_blank"
                  rel="noreferrer"
                >
                  <img src={phantomIcon} alt="" width="36" height="36" />
                  <span>
                    <strong>Phantom</strong>
                    <small>Install the wallet to connect</small>
                  </span>
                  <span className={styles.trailing} aria-hidden="true">
                    ↗
                  </span>
                </a>
              ))}
            {!external.some((wallet) => wallet.name === 'WalletConnect') && (
              <button
                type="button"
                className={styles.option}
                aria-label="Connect WalletConnect"
                aria-describedby={`${title}-walletconnect`}
                disabled
              >
                <img
                  src={walletConnectIcon}
                  alt=""
                  width="36"
                  height="36"
                  className={styles.qrIcon}
                />
                <span>
                  <strong>WalletConnect</strong>
                  <small id={`${title}-walletconnect`}>
                    {local ? 'Not available on localnet' : 'Not enabled for this deployment'}
                  </small>
                </span>
                <span className={styles.trailing} aria-hidden="true">
                  —
                </span>
              </button>
            )}
          </div>
          {import.meta.env.MODE === 'localnet' && (
            <section className={styles.testWallets} aria-label="Local test wallets">
              <h3>Test wallets</h3>
              <p>Use two wallets to try both sides of an agreement. No real funds.</p>
              <div className={styles.options}>
                {testWallets.map((wallet) => (
                  <button
                    key={wallet.name}
                    type="button"
                    className={styles.option}
                    aria-label={`Connect ${wallet.name}`}
                    disabled={!!pending}
                    onClick={() => {
                      void select(wallet);
                    }}
                  >
                    <span className={styles.testIcon} aria-hidden="true">
                      {wallet.name.endsWith('1') ? '01' : '02'}
                    </span>
                    <span>
                      <strong>{wallet.name}</strong>
                      <small>
                        {pending === wallet.name ? 'Connecting…' : 'Funded for local testing'}
                      </small>
                    </span>
                    <span className={styles.trailing} aria-hidden="true">
                      →
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      <p className={styles.footer}>Volaryn never asks for your recovery phrase or private keys.</p>
    </dialog>
  );
}

import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import styles from '../App.module.css';

function SignatureApproval({
  name,
  address,
  finish,
}: {
  name: string;
  address: string;
  finish: (approved: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.review}
      aria-labelledby="test-signature-title"
      onCancel={(event) => {
        event.preventDefault();
        finish(false);
      }}
      onClose={() => finish(false)}
    >
      <p className={styles.eyebrow}>{name} · LOCALNET</p>
      <h2 id="test-signature-title">Approve test transaction</h2>
      <p className={styles.note}>
        Sign with this test wallet. Only disposable test assets are involved.
      </p>
      <p className={styles.note}>
        Signing address <code>{address}</code>
      </p>
      <div className={styles.actions}>
        <button className={styles.outlineButton} autoFocus onClick={() => finish(false)}>
          Cancel signing
        </button>
        <button className={styles.primaryButton} onClick={() => finish(true)}>
          Sign transaction
        </button>
      </div>
    </dialog>
  );
}

/** A rendered dialog cannot be silently dismissed by browser confirm() suppression. */
export function requestDemoSignature(name: string, address: string, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      root.unmount();
      host.remove();
      if (signal.aborted) reject(signal.reason);
      else if (approved) resolve();
      else reject(new Error('Signing cancelled. No transaction was sent.'));
    };
    const abort = () => finish(false);
    signal.addEventListener('abort', abort, { once: true });
    root.render(<SignatureApproval name={name} address={address} finish={finish} />);
  });
}

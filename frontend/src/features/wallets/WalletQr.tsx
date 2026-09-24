import { useEffect, useRef, useState } from 'react';
import styles from './WalletDialog.module.css';

export function WalletQr({ uri }: { uri: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void import('qrcode')
      .then(async ({ toCanvas }) => {
        if (active && canvas.current)
          await toCanvas(canvas.current, uri, {
            width: 256,
            margin: 3,
            errorCorrectionLevel: 'M',
            color: { dark: '#08090d', light: '#ffffff' },
          });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [uri]);
  return (
    <div className={styles.pairing}>
      {failed ? (
        <p role="alert">Could not display the QR code. Close and try again.</p>
      ) : (
        <canvas ref={canvas} aria-label="WalletConnect pairing QR code" role="img" />
      )}
      <p>Scan with a WalletConnect-compatible Solana wallet.</p>
      <a href={uri}>Open wallet on this device ↗</a>
    </div>
  );
}

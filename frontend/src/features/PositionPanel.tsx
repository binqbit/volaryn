import type { ReactNode } from 'react';
import { formatUnits, type Deployment, type Position } from '../lib/api/client';
import type { usePortfolio } from './usePortfolio';
import styles from '../App.module.css';

export function PositionPanel({
  deployment,
  owner,
  walletName,
  position,
  status,
  children,
}: {
  deployment: Deployment;
  owner: string | undefined;
  walletName: string | undefined;
  position: Position | undefined;
  status: ReturnType<typeof usePortfolio>['status'];
  children: ReactNode;
}) {
  const isDemoWallet = owner === deployment.holder;
  return (
    <section id="wallet" className={styles.position} aria-labelledby="position-title">
      <div className={styles.cardHeading}>
        <h2 id="position-title">Your wallet</h2>
        <span className={styles.smallTag}>{owner ? 'CONNECTED' : 'NOT CONNECTED'}</span>
      </div>
      {!owner ? (
        <>
          <h3 className={styles.welcomeTitle}>Start with your wallet</h3>
          <p className={styles.note}>
            Connect to view balances for your address and check which protection belongs to you. No
            wallet holdings are loaded before you connect.
          </p>
          <div className={styles.demoWalletNote}>
            <strong>Try the local test wallet</strong>
            <p>
              A disposable wallet is provided with preloaded test tokens and test USDC. These demo
              balances are separate from your personal wallet.
            </p>
          </div>
          {children}
          <p className={styles.note}>
            Connecting does not move funds or activate protection. Each action needs your approval.
          </p>
        </>
      ) : (
        <>
          <div className={styles.connectedIdentity}>
            <strong>{walletName}</strong>
            <code>{owner}</code>
          </div>
          <p className={styles.note}>
            {isDemoWallet
              ? 'This is the provided test wallet. Its starting balances were preloaded for the local demo; the balances below reflect its activity on this ledger.'
              : 'Balances below are read from the local network for this connected address only.'}
          </p>
          {position ? (
            <>
              <div className={styles.assetRow}>
                <div className={styles.assetIcon} aria-hidden="true">
                  P<span>↗</span>
                </div>
                <div>
                  <h3>Demo asset balance</h3>
                  <p>TEST ASSET · Token-2022</p>
                </div>
              </div>
              <p className={styles.balance}>
                {formatUnits(position.amountRaw, position.decimals)}
                <span>raw-token units</span>
              </p>
              <p className={styles.subtle}>
                {position.amountRaw} base units in this wallet's token account
              </p>
              <div className={styles.positionDivider} />
              <dl>
                <div>
                  <dt>Available test USDC</dt>
                  <dd>{formatUnits(position.usdcAmountRaw)}</dd>
                </div>
                <div>
                  <dt>Observation</dt>
                  <dd>
                    {status === 'success'
                      ? 'Finalized'
                      : status === 'error'
                        ? 'Unavailable · last known'
                        : 'Refreshing'}
                  </dd>
                </div>
              </dl>
              <p className={styles.note}>
                Holding this asset does not mean protection is active. The mint has a scaled display
                amount; settlement uses the exact base-unit quantity in the agreement.
              </p>
              <details>
                <summary>View test asset identity</summary>
                <code>{deployment.underlyingMint}</code>
              </details>
            </>
          ) : status === 'error' ? (
            <p role="status" className={styles.note}>
              Wallet data is unavailable. Refresh observations to try again.
            </p>
          ) : status === 'success' ? (
            <p role="status" className={styles.note}>
              No supported token accounts were found for this wallet on the local network.
            </p>
          ) : (
            <p role="status" className={styles.note}>
              Loading this wallet's balances…
            </p>
          )}
        </>
      )}
    </section>
  );
}

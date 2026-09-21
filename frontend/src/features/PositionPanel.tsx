import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { formatUnits, type Deployment, type Wallet } from '../lib/api/client';
import styles from '../App.module.css';

export function PositionPanel({
  deployment,
  owner,
  walletName,
  wallet,
  status,
  children,
}: {
  deployment: Deployment;
  owner: string | undefined;
  walletName: string | undefined;
  wallet: Wallet | undefined;
  status: string;
  children: ReactNode;
}) {
  const demo = owner === deployment.holder || owner === deployment.writer;
  const underlying =
    wallet?.accounts.filter((account) => account.mint === deployment.underlyingMint) ?? [];
  const usdc = wallet?.accounts.filter((account) => account.mint === deployment.usdcMint) ?? [];
  const total = (accounts: typeof underlying) =>
    accounts.reduce((sum, account) => sum + BigInt(account.amountRaw), 0n).toString();
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
            <strong>Try a local test wallet</strong>
            <p>
              The holder starts with test assets and USDC. The writer starts with USDC to fund
              offers. Both are disposable demo wallets.
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
            {demo
              ? 'This is a provided test wallet. Its starting balances were preloaded for the local demo; the balances below reflect its activity on this ledger.'
              : 'Balances are read for this address on the connected network.'}
          </p>
          {wallet ? (
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
                {formatUnits(total(underlying))}
                <span>raw-token units across {underlying.length} accounts</span>
              </p>
              <div className={styles.positionDivider} />
              <dl>
                <div>
                  <dt>Available test USDC</dt>
                  <dd>{formatUnits(total(usdc.filter((account) => !account.frozen)))}</dd>
                </div>
                <div>
                  <dt>Observation</dt>
                  <dd>
                    {status === 'error'
                      ? 'Unavailable · last known'
                      : status === 'fetching'
                        ? 'Refreshing'
                        : 'Finalized'}
                  </dd>
                </div>
              </dl>
              {!wallet.accounts.length && (
                <p role="status" className={styles.note}>
                  No supported token accounts were found for this wallet on the local network.
                </p>
              )}
              <p className={styles.note}>
                Holding this asset does not mean protection is active. Each action uses one selected
                account; balances are not automatically combined. Frozen holdings cannot be
                delivered.
              </p>
              <details>
                <summary>Token accounts and balances</summary>
                {wallet.accounts.map((account) => (
                  <div key={account.address} className={styles.accountRow}>
                    <strong>
                      {account.mint === deployment.usdcMint ? 'USDC' : 'Demo asset'} ·{' '}
                      {formatUnits(account.amountRaw)}
                      {account.frozen ? ' · frozen' : ''}
                    </strong>
                    <code>{account.address}</code>
                  </div>
                ))}
              </details>
              <div className={styles.actions}>
                <Link className={styles.outlineButton} to="/protection">
                  Choose protection
                </Link>
                <Link className={styles.outlineButton} to="/writer">
                  Write an offer
                </Link>
              </div>
            </>
          ) : (
            <p role="status" className={styles.note}>
              {status === 'error'
                ? 'Wallet data is unavailable. Refresh observations to try again.'
                : "Loading this wallet's balances…"}
            </p>
          )}
        </>
      )}
    </section>
  );
}

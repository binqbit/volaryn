import type { ReactNode } from 'react';
import type { Deployment, Wallet } from '../lib/api/client';
import { HoldingCard } from './HoldingCard';
import { UsdcBalance } from './UsdcBalance';
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
  const demo =
    import.meta.env.MODE === 'localnet' &&
    (owner === deployment.localnet?.holder || owner === deployment.localnet?.writer);
  const holdings = deployment.assets.filter((asset) =>
    wallet?.accounts.some((account) => account.mint === asset.mint),
  );
  return (
    <section id="wallet" className={styles.position} aria-labelledby="position-title">
      <div className={styles.cardHeading}>
        <h2 id="position-title">Your wallet</h2>
        <span className={styles.smallTag}>{owner ? 'CONNECTED' : 'NOT CONNECTED'}</span>
      </div>
      {!owner ? (
        <>
          <p className={styles.note}>Connect to see your balances and manage your protection.</p>
          {import.meta.env.MODE === 'localnet' && (
            <p className={styles.note}>
              Use two test wallets to try both sides: buy protection with Test Wallet 1 and fund
              offers with Test Wallet 2, or swap roles. Disconnect to switch.
            </p>
          )}
          {children}
          <p className={styles.note}>
            Connecting is free. Funds move only after you approve a transaction.
          </p>
        </>
      ) : (
        <>
          <div className={styles.connectedIdentity}>
            <strong>{walletName}</strong>
            <code aria-label="Connected wallet address">{owner}</code>
          </div>
          {wallet ? (
            <>
              <UsdcBalance wallet={wallet} mint={deployment.usdcMint} status={status} />
              <div className={styles.holdingsHeading}>
                <h3>
                  {import.meta.env.MODE === 'localnet'
                    ? 'PreStocks demo balances'
                    : 'Your PreStocks'}
                </h3>
                <span>
                  {holdings.length} {holdings.length === 1 ? 'token' : 'tokens'}
                </span>
              </div>
              {holdings.length === 0 && (
                <p className={styles.note}>
                  {import.meta.env.MODE === 'localnet'
                    ? 'No PreStocks demo tokens in this wallet.'
                    : 'No supported PreStocks in this wallet.'}
                </p>
              )}
              <div className={styles.holdingsGrid}>
                {holdings.map((asset) => {
                  const accounts = wallet.accounts.filter((account) => account.mint === asset.mint);
                  return <HoldingCard key={asset.mint} asset={asset} accounts={accounts} />;
                })}
              </div>
              <p className={styles.note}>
                PreStocks balances exclude the issuer's display multiplier and can differ from your
                external wallet's display. They are separate from purchased protection. Frozen
                holdings cannot be delivered.
              </p>
            </>
          ) : (
            <p role="status" className={styles.note}>
              {status === 'error'
                ? 'Wallet data is unavailable. Refresh observations to try again.'
                : "Loading this wallet's balances…"}
            </p>
          )}
          <p className={styles.note}>
            {import.meta.env.MODE === 'localnet' && demo
              ? 'This is a provided test wallet. Balances reflect its activity on this local ledger.'
              : 'Balances are read for this address on the connected network.'}
          </p>
        </>
      )}
    </section>
  );
}

import { Link } from 'react-router';
import type { Deployment, Wallet } from '../lib/api/client';
import type { ActionRequest } from '../lib/chain/actionTypes';
import { OfferForm } from '../features/OfferForm';
import { ConnectWalletButton } from '../features/wallets/WalletConnection';
import styles from '../App.module.css';

export function CreateOfferPage({
  deployment,
  owner,
  wallet,
  status,
  busy,
  onReview,
}: {
  deployment: Deployment;
  owner?: string;
  wallet?: Wallet;
  status: string;
  busy: boolean;
  onReview: (request: ActionRequest) => Promise<void>;
}) {
  return (
    <>
      <Link className={styles.backLink} to="/offers">
        ← Explore offers
      </Link>
      <div className={styles.pageHeading}>
        <div>
          <p className={styles.eyebrow}>SET YOUR TERMS</p>
          <h1>Create an offer</h1>
          <p>Request a funded exit for your tokens, or provide the capital for another holder.</p>
        </div>
      </div>
      {!owner ? (
        <div className={styles.emptyState}>
          <h2>Connect a wallet to create an offer</h2>
          <p>
            Request protection with an escrowed USDC premium, or provide the full payout. Both need
            SOL for transaction fees.
            {import.meta.env.MODE === 'localnet' &&
              ' For a local protection request, choose Test Wallet 1.'}
          </p>
          <ConnectWalletButton className={styles.outlineButton}>
            Choose a wallet
          </ConnectWalletButton>
        </div>
      ) : wallet ? (
        <div className={styles.surface}>
          <OfferForm
            key={owner}
            deployment={deployment}
            wallet={wallet}
            walletStatus={status}
            busy={busy}
            onReview={onReview}
          />
        </div>
      ) : (
        <div className={styles.emptyState} role="status">
          {status === 'error'
            ? 'Wallet balances are unavailable. Refresh before creating an offer.'
            : 'Loading your funding accounts…'}
        </div>
      )}
      <p className={styles.note}>
        You can cancel before acceptance to recover your deposit. After activation, the premium
        belongs to the provider and the payout stays reserved until exercise or expiry. Track both
        sides in <Link to="/portfolio">My portfolio</Link>.
      </p>
    </>
  );
}

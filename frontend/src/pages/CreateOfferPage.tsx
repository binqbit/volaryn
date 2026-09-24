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
          <p className={styles.eyebrow}>PROVIDE CAPITAL</p>
          <h1>Create an offer</h1>
          <p>Offer to buy tokens at a fixed payout. Earn a premium for reserving the USDC.</p>
        </div>
      </div>
      {!owner ? (
        <div className={styles.emptyState}>
          <h2>Connect a wallet to create an offer</h2>
          <p>
            You need USDC for the full payout and SOL for transaction fees.
            {import.meta.env.MODE === 'localnet' &&
              ' For the local demonstration, choose Test Wallet 2.'}
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
        You can cancel before acceptance. After activation, the payout stays reserved until the
        holder exercises or protection expires. Manage your commitments in{' '}
        <Link to="/portfolio/written">My offers</Link>.
      </p>
    </>
  );
}

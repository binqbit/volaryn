import { useEffect, useRef, useState } from 'react';
import { useConnectedWallet, useDisconnect } from '@solana/kit-plugin-wallet/react';
import { useClient } from '@solana/react';
import { Link, NavLink, Outlet, Route, Routes, useNavigate, useLocation } from 'react-router';
import { shortAddress, type Deployment } from './lib/api/client';
import type { AppClient } from './lib/chain/client';
import { useWallet } from './features/useWallet';
import { ActionReview } from './features/ActionReview';
import { TransactionStatus } from './features/TransactionStatus';
import type { ActionRequest, ActionReview as Review } from './lib/chain/actionTypes';
import { useTransaction } from './features/useTransaction';
import { PositionPanel } from './features/PositionPanel';
import { ConnectWalletButton } from './features/wallets/WalletConnection';
import { InfoPopover } from './features/InfoPopover';
import info from './features/InfoContent.module.css';
import { OfficialAssets } from './features/OfficialAssets';
import { HomePage } from './pages/HomePage';
import { OffersPage } from './pages/OffersPage';
import { CreateOfferPage } from './pages/CreateOfferPage';
import { PortfolioPage } from './pages/PortfolioPage';
import { AgreementPage } from './pages/AgreementPage';
import styles from './App.module.css';

export function App({ deployment }: { deployment: Deployment }) {
  const client = useClient<AppClient>();
  const connected = useConnectedWallet(client);
  const disconnect = useDisconnect(client);
  const navigate = useNavigate();
  const location = useLocation();
  const owner = connected?.account.address;
  const [revision, setRevision] = useState(0);
  // Keep transaction recovery mounted when the user moves between pages.
  const transaction = useTransaction(
    client,
    deployment,
    owner,
    location.pathname === '/portfolio/activity'
      ? (new URLSearchParams(location.search).get('before') ?? undefined)
      : undefined,
  );
  const wallet = useWallet(owner);
  const [review, setReview] = useState<{ request: ActionRequest; value: Review }>();
  const [reviewError, setReviewError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const previewLock = useRef(false);
  const reviewTrigger = useRef<HTMLElement | null>(null);
  const actionError = useRef<HTMLDivElement>(null);
  const visibleReview = review?.value.owner === owner ? review : undefined;
  const workspace =
    location.pathname.startsWith('/offers') ||
    location.pathname.startsWith('/portfolio') ||
    location.pathname.startsWith('/agreements');

  useEffect(() => {
    if (!visibleReview && (reviewError || transaction.error)) {
      actionError.current?.focus();
      actionError.current?.scrollIntoView({ block: 'center' });
    }
  }, [reviewError, transaction.error, visibleReview]);

  useEffect(() => {
    const main = document.getElementById('main');
    document.title = `${main?.querySelector('h1')?.textContent ?? 'Volaryn'} · Volaryn`;
    if (location.hash === '#wallet') document.getElementById('wallet')?.scrollIntoView();
    else {
      window.scrollTo(0, 0);
      main?.focus({ preventScroll: true });
    }
  }, [location.pathname, location.hash]);

  const onReview = async (request: ActionRequest) => {
    if (previewLock.current || transaction.busy) return;
    previewLock.current = true;
    reviewTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPreparing(true);
    setReviewError('');
    try {
      const value = await transaction.preview(request);
      setReview({ request, value });
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : 'Unable to prepare the review');
    } finally {
      previewLock.current = false;
      setPreparing(false);
    }
  };
  const confirm = async () => {
    if (!visibleReview || previewLock.current) return;
    previewLock.current = true;
    try {
      const agreement = await transaction.execute(visibleReview.request, visibleReview.value);
      setReview(undefined);
      if (agreement) await navigate(`/agreements/${agreement}`);
      setRevision((value) => value + 1);
      wallet.refresh();
    } finally {
      previewLock.current = false;
    }
  };
  const busy = transaction.busy || preparing || wallet.status === 'error';
  const usable = !!wallet.data && !busy;
  const walletPanel = (
    <PositionPanel
      deployment={deployment}
      owner={owner}
      walletName={connected?.wallet.name}
      wallet={wallet.data}
      status={wallet.status}
    >
      <ConnectWalletButton className={styles.walletButton} />
    </PositionPanel>
  );

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link to="/" className={styles.brand} aria-label="Volaryn home">
          <span className={styles.mark}>V</span>Volaryn<span className={styles.brandDot}>.</span>
        </Link>
        <nav aria-label="Main navigation">
          <NavLink end to="/">
            Home
          </NavLink>
          <NavLink end to="/offers">
            Explore offers
          </NavLink>
          <NavLink to="/offers/new">Create offer</NavLink>
          <NavLink to="/portfolio">My portfolio</NavLink>
          <NavLink to="/issuer-assets">Official assets</NavLink>
        </nav>
        <div className={styles.wallet}>
          {connected ? (
            <>
              <Link to="/portfolio#wallet" className={styles.walletIdentity}>
                <strong>{shortAddress(owner!)}</strong>
                <span>View wallet</span>
              </Link>
              <button
                className={styles.outlineButton}
                onClick={() => {
                  setReview(undefined);
                  setReviewError('');
                  disconnect.dispatch();
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <ConnectWalletButton className={styles.outlineButton} />
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {import.meta.env.MODE === 'localnet' && (
          <div className={styles.demoNotice}>
            <span>LOCALNET DEMO</span>
            <InfoPopover title="Test tokens · no real funds">
              <section className={info.section}>
                <h3>Test wallets & tokens</h3>
                <p>
                  Try the full workflow with disposable PreStocks replicas. No real funds or
                  private-market exposure.
                </p>
              </section>
              <section className={info.section}>
                <h3>Official PreStocks assets</h3>
                <p>
                  Mainnet assets are available for read-only browsing, separate from your test
                  balances.
                </p>
              </section>
            </InfoPopover>
          </div>
        )}
        {(transaction.error ||
          reviewError ||
          (workspace && owner && wallet.status === 'error')) && (
          <div ref={actionError} className={styles.error} role="alert" tabIndex={-1}>
            {reviewError ||
              transaction.error ||
              (workspace && owner && wallet.status === 'error'
                ? 'Chain data is unavailable. Displayed observations may be stale; actions are paused.'
                : '')}
            <button onClick={() => wallet.refresh()}>Refresh observations</button>
          </div>
        )}
        {preparing && <p role="status">Checking balances, terms and network fees…</p>}
        <TransactionStatus transaction={transaction} />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            element={
              <div className={styles.workspace}>
                <div className={styles.workspaceMain}>
                  <Outlet />
                </div>
                <aside className={styles.walletAside}>{walletPanel}</aside>
              </div>
            }
          >
            <Route path="/offers" element={<OffersPage deployment={deployment} owner={owner} />} />
            <Route
              path="/offers/new"
              element={
                <CreateOfferPage
                  deployment={deployment}
                  owner={owner}
                  wallet={wallet.data}
                  status={wallet.status}
                  busy={busy}
                  onReview={onReview}
                />
              }
            />
            <Route
              path="/portfolio"
              element={
                <PortfolioPage
                  deployment={deployment}
                  owner={owner}
                  activity={transaction.activity}
                />
              }
            />
            <Route
              path="/portfolio/protection"
              element={
                <PortfolioPage
                  deployment={deployment}
                  owner={owner}
                  activity={transaction.activity}
                  view="holder"
                />
              }
            />
            <Route
              path="/portfolio/written"
              element={
                <PortfolioPage
                  deployment={deployment}
                  owner={owner}
                  activity={transaction.activity}
                  view="writer"
                />
              }
            />
            <Route
              path="/portfolio/activity"
              element={
                <PortfolioPage
                  deployment={deployment}
                  owner={owner}
                  activity={transaction.activity}
                  view="activity"
                />
              }
            />
            <Route
              path="/agreements/:address"
              element={
                <AgreementPage
                  deployment={deployment}
                  owner={owner}
                  wallet={wallet.data}
                  walletStatus={wallet.status}
                  usable={usable}
                  revision={revision}
                  activity={transaction.activity}
                  onReview={onReview}
                />
              }
            />
          </Route>
          <Route path="/issuer-assets" element={<OfficialAssets />} />
          <Route
            path="*"
            element={
              <div className={styles.emptyState}>
                <h1>Page not found</h1>
                <p>Find an offer, create one, or return to your portfolio.</p>
                <Link to="/offers">Explore offers →</Link>
              </div>
            }
          />
        </Routes>
      </main>
      {visibleReview && (
        <ActionReview
          assets={deployment.assets}
          review={visibleReview.value}
          busy={transaction.busy}
          onConfirm={() => {
            void confirm();
          }}
          onCancel={() => {
            setReview(undefined);
            requestAnimationFrame(() => reviewTrigger.current?.focus());
          }}
        />
      )}
      <footer>
        <span>Volaryn.</span>
        <p>Protection starts with a fully reserved payout. Your choice to exercise.</p>
        <Link to="/offers">Explore offers ↗</Link>
      </footer>
    </div>
  );
}

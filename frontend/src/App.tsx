import { useRef, useState } from 'react';
import {
  useConnectedWallet,
  useConnect,
  useDisconnect,
  useWallets,
} from '@solana/kit-plugin-wallet/react';
import { useClient } from '@solana/react';
import { Link, useMatch, useSearchParams, useNavigate, useLocation } from 'react-router';
import { shortAddress, formatUnits, type Deployment } from './lib/api/client';
import type { AppClient } from './lib/chain/client';
import { usePortfolio, type PortfolioQuery } from './features/usePortfolio';
import { useWallet } from './features/useWallet';
import { useChainTime } from './features/useChainTime';
import { OfferForm } from './features/OfferForm';
import { OfferFilters } from './features/OfferFilters';
import { ActionReview } from './features/ActionReview';
import { TransactionStatus } from './features/TransactionStatus';
import type { ActionRequest, ActionReview as Review } from './lib/chain/actionTypes';
import { useTransaction } from './features/useTransaction';
import { PositionPanel } from './features/PositionPanel';
import { AgreementPanel } from './features/AgreementPanel';
import styles from './App.module.css';

export function App({ deployment }: { deployment: Deployment }) {
  const client = useClient<AppClient>();
  const connected = useConnectedWallet(client);
  const wallets = useWallets(client);
  const connect = useConnect(client);
  const disconnect = useDisconnect(client);
  const selected = useMatch('/agreements/:address')?.params.address;
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const owner = connected?.account.address;
  const location = useLocation();
  const writerPage = location.pathname === '/writer';
  const protectionPage = location.pathname === '/protection';
  const [filters, setFilters] = useState<PortfolioQuery>({ mode: 'offers' });
  const query: PortfolioQuery = writerPage
    ? { mode: 'writer' }
    : protectionPage
      ? filters
      : { mode: 'all' };
  const transaction = useTransaction(client, deployment, owner);
  const wallet = useWallet(owner);
  const now = useChainTime(client);
  const portfolio = usePortfolio(
    deployment,
    owner,
    selected,
    search.get('after') ?? undefined,
    query,
  );
  const [review, setReview] = useState<{ request: ActionRequest; value: Review }>();
  const [reviewError, setReviewError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const previewLock = useRef(false);
  const reviewTrigger = useRef<HTMLElement | null>(null);
  const visibleReview = review?.value.owner === owner ? review : undefined;
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
      portfolio.refresh();
      wallet.refresh();
    } finally {
      previewLock.current = false;
    }
  };
  const agreements = portfolio.data?.agreements ?? [];
  const usable =
    !!wallet.data &&
    wallet.status !== 'error' &&
    portfolio.status !== 'error' &&
    !transaction.busy &&
    !preparing;
  const busy = transaction.busy || preparing || wallet.status === 'error';
  const unavailable = portfolio.status === 'error' || (!!owner && wallet.status === 'error');
  const refresh = () => {
    portfolio.refresh();
    wallet.refresh();
  };
  const capital = agreements
    .filter((item) => item.status === 'funded' || item.status === 'active')
    .reduce((sum, item) => sum + BigInt(item.reserveAmount), 0n);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <span className={styles.mark}>V</span>Volaryn<span className={styles.brandDot}>.</span>
        </Link>
        <nav aria-label="Main navigation">
          <a href="#wallet">Your wallet</a>
          <Link to="/protection">Protection</Link>
          <Link to="/writer">Writer</Link>
        </nav>
        <div className={styles.wallet}>
          <span className={styles.network}>
            <i />
            Localnet
          </span>
          {connected ? (
            <>
              <a href="#wallet" className={styles.walletIdentity}>
                <strong>{connected.wallet.name}</strong>
                <span>Connected · {shortAddress(connected.account.address)}</span>
              </a>
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
            <a className={styles.outlineButton} href="#wallet">
              Connect wallet
            </a>
          )}
        </div>
      </header>

      <main>
        <div className={styles.demoNotice}>
          <span>LOCAL DEMONSTRATION</span> Disposable assets and test wallets. No real funds or
          official PreStocks holdings.
        </div>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>YOUR POSITION. YOUR DECISION.</p>
            <h1>
              Keep the upside.
              <br />
              <em>Define your exit.</em>
            </h1>
            <p className={styles.intro}>
              Keep your asset while securing a funded right to exchange it for an agreed USDC
              payout. You decide whether to exercise.
            </p>
          </div>
          <div className={styles.heroAside}>
            <span className={styles.circle}>↗</span>
            <p>
              Protection, with
              <br />
              <strong>capital already reserved.</strong>
            </p>
            <span className={styles.subtle}>Settlement enforced on Solana</span>
          </div>
        </section>
        {(connect.error || transaction.error || reviewError || unavailable) && (
          <div className={styles.error} role="alert">
            {reviewError ||
              transaction.error ||
              (unavailable
                ? 'Chain data is unavailable. Displayed observations may be stale; actions are paused.'
                : 'Wallet connection failed.')}
            <button onClick={refresh}>Refresh observations</button>
          </div>
        )}
        <div className={styles.layout}>
          <PositionPanel
            deployment={deployment}
            owner={connected?.account.address}
            walletName={connected?.wallet.name}
            wallet={wallet.data}
            status={wallet.status}
          >
            {wallets.map((wallet) => (
              <button
                key={wallet.name}
                className={styles.primaryButton}
                disabled={connect.isRunning}
                onClick={() => connect.dispatch(wallet)}
              >
                Connect {wallet.name}
              </button>
            ))}
            {wallets.length === 0 && <p className={styles.note}>No compatible wallet found.</p>}
          </PositionPanel>
          <section id="protection" className={styles.protection} aria-label="Protection">
            <div className={styles.cardHeading}>
              <h2>
                {selected
                  ? 'Agreement details'
                  : writerPage
                    ? 'Writer workspace'
                    : protectionPage
                      ? 'Choose protection'
                      : 'Public agreements'}
              </h2>
            </div>
            <p className={styles.note}>
              {selected
                ? 'Public agreement terms and the actions available to your connected wallet.'
                : writerPage
                  ? 'Fund offers, follow commitments, and manage returned capital and delivered assets.'
                  : protectionPage
                    ? 'Match fixed terms to the quantity you intend to protect. Activation does not lock your underlying tokens.'
                    : 'Offers and agreements on this local network. Browsing them does not add protection to your wallet.'}
            </p>
            {selected && (
              <Link className={styles.backLink} to="/">
                ← All public agreements
              </Link>
            )}
            {writerPage &&
              (wallet.data ? (
                <OfferForm
                  key={owner}
                  wallet={wallet.data}
                  deployment={deployment}
                  busy={busy}
                  onReview={onReview}
                />
              ) : (
                <p className={styles.note}>
                  Connect a wallet with USDC to create and manage offers.
                </p>
              ))}
            {writerPage && owner && (
              <>
                <h3>Your commitments</h3>
                <p className={styles.note}>
                  Reserved across funded and active agreements on this page:{' '}
                  {formatUnits(capital.toString())} USDC. Available balances and received token
                  accounts appear in Your wallet.
                </p>
              </>
            )}
            {protectionPage && (
              <>
                <div className={styles.actions}>
                  <button
                    className={styles.outlineButton}
                    aria-pressed={filters.mode === 'offers'}
                    onClick={() => {
                      setFilters({ ...filters, mode: 'offers' });
                      void navigate('/protection');
                    }}
                  >
                    Available offers
                  </button>
                  <button
                    className={styles.outlineButton}
                    aria-pressed={filters.mode === 'holder'}
                    disabled={!owner}
                    onClick={() => {
                      setFilters({ mode: 'holder' });
                      void navigate('/protection');
                    }}
                  >
                    My protection
                  </button>
                </div>
                {filters.mode === 'offers' && (
                  <OfferFilters
                    value={filters}
                    onChange={(value) => {
                      setFilters(value);
                      void navigate('/protection');
                    }}
                  />
                )}
              </>
            )}
            {preparing && <p role="status">Checking balances, terms and network fees…</p>}
            {agreements.map((agreement) => (
              <AgreementPanel
                key={agreement.address}
                agreement={agreement}
                owner={owner}
                wallet={wallet.data}
                usable={usable}
                now={now}
                onReview={onReview}
              />
            ))}
            {portfolio.status === 'fetching' && !portfolio.data && (
              <p role="status">Loading agreements…</p>
            )}
            {portfolio.status === 'success' && agreements.length === 0 && (
              <p>
                {writerPage
                  ? 'No agreements written by this wallet on this page.'
                  : protectionPage
                    ? filters.mode === 'holder'
                      ? 'No active protection for this wallet.'
                      : 'No funded offers match these terms. Try changing the filters.'
                    : 'No public agreements to show on this page.'}
              </p>
            )}
            {!selected && (
              <nav className={styles.agreementPages} aria-label="Agreement pages">
                {search.has('after') && <Link to={location.pathname}>First page</Link>}
                {portfolio.data?.next && (
                  <Link
                    to={`${location.pathname}?after=${encodeURIComponent(portfolio.data.next)}`}
                  >
                    Next agreements
                  </Link>
                )}
              </nav>
            )}
            <TransactionStatus transaction={transaction} connected={!!connected} />
          </section>
        </div>
        <section className={styles.steps} aria-label="How protection works">
          <div>
            <b>01</b>
            <h3>Keep your position</h3>
            <p>Your underlying asset stays in your wallet after activation.</p>
          </div>
          <div>
            <b>02</b>
            <h3>Pay a known premium</h3>
            <p>The writer reserves the entire payout before you activate.</p>
          </div>
          <div>
            <b>03</b>
            <h3>Choose your exit</h3>
            <p>Deliver the agreed quantity before expiry, or let protection end.</p>
          </div>
        </section>
      </main>
      {visibleReview && (
        <ActionReview
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
        <p>Explicit terms. Fully funded obligations. Your choice to exercise.</p>
        <span>Built on Solana ↗</span>
      </footer>
    </div>
  );
}

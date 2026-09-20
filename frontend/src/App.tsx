import {
  useConnectedWallet,
  useConnect,
  useDisconnect,
  useWallets,
} from '@solana/kit-plugin-wallet/react';
import { useClient } from '@solana/react';
import { Link, useMatch, useSearchParams, useNavigate } from 'react-router';
import { shortAddress, type Deployment, type Agreement, type Position } from './lib/api/client';
import type { AppClient } from './lib/chain/client';
import { usePortfolio } from './features/usePortfolio';
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
  const transaction = useTransaction(client, deployment, connected?.account.address);
  const portfolio = usePortfolio(
    deployment,
    connected?.account.address,
    selected ?? transaction.pending?.agreement,
    search.get('after') ?? undefined,
  );
  const onAction = async (
    agreement: Agreement,
    position: Position,
    operation: 'activate' | 'exercise',
  ) => {
    await navigate(`/agreements/${agreement.address}`);
    await transaction.execute(agreement, position, operation);
  };
  const position = portfolio.data?.positions.find(
    (item) => item.owner === connected?.account.address,
  );
  const agreements = portfolio.data?.agreements ?? [];
  const usable = !!position && portfolio.status === 'success' && !transaction.busy;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          <span className={styles.mark}>V</span>Volaryn<span className={styles.brandDot}>.</span>
        </Link>
        <nav aria-label="Main navigation">
          <a href="#wallet">Your wallet</a>
          <Link to="/#protection">Public agreements</Link>
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
              <button className={styles.outlineButton} onClick={() => disconnect.dispatch()}>
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
          <span>LOCAL DEMONSTRATION</span> Disposable assets and a test wallet. No real funds or
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
        {(connect.error || transaction.error || portfolio.status === 'error') && (
          <div className={styles.error} role="alert">
            {transaction.error ||
              (portfolio.status === 'error'
                ? 'Chain data is unavailable. Displayed observations may be stale; actions are paused.'
                : 'Wallet connection failed.')}
            <button onClick={() => portfolio.refresh()}>Refresh observations</button>
          </div>
        )}
        <div className={styles.layout}>
          <PositionPanel
            deployment={deployment}
            owner={connected?.account.address}
            walletName={connected?.wallet.name}
            position={position}
            status={portfolio.status}
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
              <h2>{selected ? 'Agreement details' : 'Public agreements'}</h2>
            </div>
            <p className={styles.note}>
              {selected
                ? 'A public record on this local network. The holder address determines who can exercise.'
                : 'Offers and agreements on this local network. Browsing them does not add protection to your wallet.'}
            </p>
            {selected && (
              <Link className={styles.backLink} to="/#protection">
                ← All public agreements
              </Link>
            )}
            {!selected && portfolio.data && (
              <nav className={styles.agreementPages} aria-label="Agreement pages">
                {agreements.map((agreement) => (
                  <Link key={agreement.address} to={`/agreements/${agreement.address}`}>
                    {shortAddress(agreement.address)} · {agreement.status}
                  </Link>
                ))}
                {search.has('after') && <Link to="/">First page</Link>}
                {portfolio.data.next && (
                  <Link to={`/?after=${encodeURIComponent(portfolio.data.next)}`}>
                    Next agreements
                  </Link>
                )}
              </nav>
            )}
            <AgreementPanel
              agreement={
                selected ? agreements.find((item) => item.address === selected) : agreements[0]
              }
              owner={connected?.account.address}
              position={position}
              usable={usable}
              onAction={onAction}
            />
            {portfolio.status === 'fetching' && !portfolio.data && (
              <p role="status">Loading public agreements…</p>
            )}
            {portfolio.status === 'success' && agreements.length === 0 && (
              <p>No public agreements to show on this page.</p>
            )}
            <div
              className={styles.transaction}
              role="status"
              aria-label="Transaction status"
              aria-live="polite"
            >
              {transaction.phase === 'idle'
                ? connected
                  ? 'Your wallet signs. The contract settles.'
                  : 'Browsing only · no wallet connected'
                : transaction.phase === 'awaiting-signature'
                  ? 'Waiting for wallet approval…'
                  : transaction.phase === 'provisional'
                    ? 'Confirmed on chain · waiting for finality'
                    : transaction.phase === 'finalized'
                      ? 'Transaction finalized'
                      : transaction.phase === 'reconciled'
                        ? 'Action verified from finalized agreement state'
                        : transaction.phase === 'expired'
                          ? 'Signature expired · action not completed'
                          : transaction.phase === 'unresolved'
                            ? 'Outcome unresolved · reconciling signature'
                            : transaction.phase === 'pending'
                              ? 'Transaction submitted · confirmation pending'
                              : 'Transaction was not completed'}
              {transaction.pending && <code>{transaction.pending.signature}</code>}
            </div>
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
      <footer>
        <span>Volaryn.</span>
        <p>Explicit terms. Fully funded obligations. Your choice to exercise.</p>
        <span>Built on Solana ↗</span>
      </footer>
    </div>
  );
}

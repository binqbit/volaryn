import { Link } from 'react-router';
import layout from '../App.module.css';
import styles from './HomePage.module.css';

export function HomePage() {
  return (
    <>
      <section className={styles.hero}>
        <div>
          <p className={layout.eyebrow}>PRESTOCKS PROTECTION · BUILT ON SOLANA</p>
          <h1>
            Set a price floor
            <br />
            <em>for your PreStocks.</em>
          </h1>
          <p className={styles.intro}>
            Pay a premium for the right to sell an agreed quantity of PreStocks tokens for a fixed
            USDC payout before expiry. Your PreStocks stay in your wallet, and you choose whether to
            sell.
          </p>
          <div className={layout.actions}>
            <Link className={layout.primaryButton} to="/offers">
              Explore offers <span>↗</span>
            </Link>
            <a className={layout.outlineButton} href="#how-it-works">
              How it works ↓
            </a>
            <Link to="/issuer-assets">PreStocks catalogue ↗</Link>
          </div>
          <p className={styles.caption}>
            For tokenized private-market exposure such as OpenAI, SpaceX and Anthropic.{' '}
            {import.meta.env.MODE === 'localnet'
              ? 'Explore local demo replicas or view the official PreStocks catalogue.'
              : 'Browse funded offers and explore the official PreStocks catalogue.'}
          </p>
        </div>
        <div className={styles.diagram} role="group" aria-label="PreStocks price floor example">
          <div className={styles.orbit} aria-hidden="true" />
          <div className={styles.diagramTop}>
            <span className={layout.smallTag}>ILLUSTRATIVE EXAMPLE</span>
            <span className={styles.chain}>● On Solana</span>
          </div>
          <div className={styles.participant}>
            <span className={styles.symbol}>↗</span>
            <div>
              <strong>10 OPENAI PreStocks tokens</strong>
              <p>Stay in your wallet after activation</p>
            </div>
          </div>
          <div className={styles.connection}>
            <span />
            30 USDC premium · 30 days to decide
            <span />
          </div>
          <div className={styles.participant}>
            <span className={styles.symbol}>$</span>
            <div>
              <strong>800 USDC reserved</strong>
              <p>80 USDC per token, funded by the writer</p>
            </div>
          </div>
          <div className={styles.settlement}>
            <span>YOUR CHOICE BEFORE EXPIRY</span>
            <strong>
              <span>10 OPENAI → writer</span> <i aria-hidden="true">⇄</i>{' '}
              <span>800 USDC → you</span>
            </strong>
            <p>Example terms, not a live offer. Premium and network fees are separate.</p>
          </div>
        </div>
      </section>
      <section className={styles.roles} aria-label="Choose your role">
        <div className={styles.role}>
          <p className={layout.eyebrow}>FOR PRESTOCKS HOLDERS</p>
          <h2>
            Keep the potential upside.
            <br />
            Know your exit price.
          </h2>
          <p>
            Keep your PreStocks if you want to hold. If you choose to sell before expiry, deliver
            the agreed quantity for the fixed USDC payout, even if its market price has fallen.
          </p>
          <Link to="/offers">
            Find protection <span>↗</span>
          </Link>
        </div>
        <div className={styles.role}>
          <p className={layout.eyebrow}>FOR CAPITAL PROVIDERS</p>
          <h2>
            Set the terms.
            <br />
            Back them with USDC.
          </h2>
          <p>
            Create an offer and reserve its full payout. Receive a premium when a holder accepts,
            and buy their PreStocks tokens if they exercise.
          </p>
          <Link to="/offers/new">
            Create an offer <span>↗</span>
          </Link>
        </div>
      </section>
      <section id="how-it-works" className={styles.how} aria-labelledby="how-title">
        <p className={layout.eyebrow}>FROM PRESTOCKS TO PROTECTION</p>
        <h2 id="how-title">Clear terms. Your decision.</h2>
        <div className={styles.steps}>
          <div>
            <b>01 / FIND</b>
            <h3>Choose a funded offer</h3>
            <p>
              Compare the PreStocks asset, quantity, payout, premium and expiry. The writer has
              already reserved the payout.
            </p>
          </div>
          <div>
            <b>02 / ACTIVATE</b>
            <h3>Pay the premium</h3>
            <p>Review and sign with your wallet. Your PreStocks tokens remain yours to hold.</p>
          </div>
          <div>
            <b>03 / DECIDE</b>
            <h3>Exercise or let it expire</h3>
            <p>
              Deliver the full agreed PreStocks quantity for the reserved USDC before expiry, or
              keep holding. The premium is not returned.
            </p>
          </div>
        </div>
        <p className={styles.boundary}>
          The floor applies to the agreed PreStocks quantity until expiry. You must choose to
          exercise and deliver the transferable tokens; issuer restrictions can prevent delivery.
          Sales are never automatic. Premium and network fees reduce your net proceeds.
        </p>
      </section>
      <section className={styles.start}>
        <div>
          <p className={layout.eyebrow}>EXPLORE AT YOUR OWN PACE</p>
          <h2>See the terms before you connect.</h2>
          <p>Browse public offers freely. Connect a wallet when you are ready to take action.</p>
        </div>
        <Link className={layout.primaryButton} to="/offers">
          Browse available offers <span>↗</span>
        </Link>
      </section>
    </>
  );
}

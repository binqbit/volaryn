import { Link } from 'react-router';
import type { Asset } from '../../lib/api/client';
import { InfoPopover } from '../InfoPopover';
import { formatUtcDate } from './terms';
import type { OfferTerms } from './useOfferTerms';
import layout from '../../App.module.css';
import info from '../InfoContent.module.css';
import styles from './OfferTerms.module.css';
import type { OfferSide } from '../../lib/chain/actionTypes';

function policyDate(seconds: bigint) {
  // The local policy has an unlimited i64 timestamp, which is not a JavaScript date.
  if (seconds < 0n) return 'Unavailable';
  return seconds > 253402300799n
    ? 'No fixed date'
    : `${formatUtcDate(seconds).replace('T', ' ')} UTC`;
}

export function OfferTermsFields({
  terms,
  asset,
  side,
}: {
  terms: OfferTerms;
  asset?: Asset;
  side: OfferSide;
}) {
  const local = import.meta.env.MODE === 'localnet';
  const { pricing, dates, context, suggested } = terms;
  return (
    <>
      <div className={styles.amounts}>
        <label className={layout.field}>
          <span>Gross quantity (unscaled tokens)</span>
          <input
            required
            inputMode="decimal"
            value={terms.quantity}
            onChange={(event) => terms.setQuantity(event.target.value)}
          />
        </label>
        <label className={layout.field}>
          <span>Payout (USDC)</span>
          <input
            required
            inputMode="decimal"
            value={terms.payout}
            onChange={(event) => terms.setPayout(event.target.value)}
            placeholder="Enter the payout to reserve"
          />
        </label>
        <div className={styles.premium}>
          <label className={layout.field}>
            <span>Premium (USDC)</span>
            <input
              required
              inputMode="decimal"
              value={pricing.premium}
              onChange={(event) => terms.setPremium(event.target.value)}
              aria-describedby="premium-basis"
            />
          </label>
          <label className={layout.field}>
            <span>Premium (%)</span>
            <input
              inputMode="decimal"
              value={pricing.rate}
              onChange={(event) => terms.setRate(event.target.value)}
              aria-describedby="premium-basis"
            />
          </label>
        </div>
      </div>
      <div className={styles.explanation}>
        <p id="premium-basis">
          {terms.premiumKind === 'rate'
            ? 'Premium follows the payout at your chosen percentage.'
            : 'Premium is fixed in USDC. The percentage is an approximate comparison.'}{' '}
          The starting terms are 100 USDC payout and 10 USDC premium (10%). You can edit both.
          {terms.premiumKind === 'amount' &&
            pricing.rate === '0' &&
            pricing.net !== undefined &&
            ' Your premium is less than 0.01% of the payout; the USDC amount remains exact.'}
        </p>
        <InfoPopover title="How amounts are calculated">
          <section className={info.section}>
            <h3>Your terms</h3>
            <p>
              Enter the premium as an amount or a percentage of the reserved payout. The last field
              you edit determines how it follows payout changes. Percentage-based amounts round up
              to the nearest 0.000001 USDC.
            </p>
            <p>
              {side === 'holder'
                ? 'The premium is escrowed now and paid to the provider only when they fund the payout.'
                : 'The holder pays you the premium once on activation.'}{' '}
              If the holder exercises, they receive the full payout and deliver the gross quantity.
              An issuer transfer fee can reduce the provider’s token receipt.
            </p>
          </section>
          <section className={info.section}>
            <h3>Price context</h3>
            <p>
              PreStocks source prices do not establish price time or their relationship to unscaled
              token units. They are not used to set these amounts, predict stability, or estimate
              demand.
            </p>
            <p>
              The starting amounts are an editable template, not a valuation of the selected token.
            </p>
            <div className={info.links}>
              <Link
                target="_blank"
                rel="noreferrer"
                to={`/issuer-assets${asset ? `?q=${encodeURIComponent(asset.referenceMint)}` : ''}`}
              >
                View official asset context ↗
              </Link>
            </div>
          </section>
        </InfoPopover>
      </div>
      {pricing.error && (
        <p className={styles.warning} role="status">
          {pricing.error}
        </p>
      )}
      {pricing.net !== undefined && (
        <dl className={styles.summary} aria-label="Offer economics">
          <div>
            <dt>{side === 'holder' ? 'Premium you escrow' : 'You earn on activation'}</dt>
            <dd>{pricing.premium} USDC</dd>
          </div>
          <div>
            <dt>Holder payout after premium</dt>
            <dd>
              {pricing.net} USDC <small>if exercised · before other costs</small>
            </dd>
          </div>
        </dl>
      )}
      {asset && (
        <p className={layout.note}>
          Enter {asset.symbol} before the issuer's display multiplier. One unscaled token is{' '}
          {(10n ** BigInt(asset.decimals)).toString()} base units. Your external wallet may show a
          different scaled balance.
        </p>
      )}
      <div className={styles.schedule}>
        <div className={styles.scheduleControls}>
          <label className={layout.field}>
            <span>Suggested protection duration</span>
            <select
              value={terms.duration}
              onChange={(event) => terms.setDuration(event.target.value)}
            >
              <option value="7200">2 hours</option>
              <option value="86400">1 day</option>
              <option value="604800">7 days</option>
              <option value="2592000">30 days</option>
            </select>
          </label>
          <button
            type="button"
            className={layout.outlineButton}
            disabled={!suggested || 'error' in suggested}
            onClick={terms.applyDates}
          >
            Apply suggested dates
          </button>
        </div>
        <p className={styles.caption}>
          {!asset
            ? 'Choose a token to get dates within its approved limits.'
            : context.status === 'fetching'
              ? 'Checking this token’s approved dates…'
              : context.status === 'error'
                ? 'Date suggestions are unavailable. Enter dates manually; they are checked again before signing.'
                : suggested && 'error' in suggested
                  ? suggested.error
                  : suggested?.limited
                    ? 'The suggested dates are shortened to fit this asset’s approval limits.'
                    : `${local ? 'One hour' : 'Up to one day'} to accept, within the selected duration. You can edit both dates.`}
        </p>
        {asset && context.status === 'error' && (
          <button type="button" className={styles.refresh} onClick={() => context.refresh()}>
            Retry date suggestions
          </button>
        )}
        {context.data && (
          <InfoPopover title="Asset date limits">
            <section className={info.section}>
              <h3>
                {asset?.symbol} · {local ? 'Local demo policy' : 'On-chain policy'}
              </h3>
              <dl className={info.facts}>
                <div>
                  <dt>Latest protection expiry</dt>
                  <dd>{policyDate(context.data.policy.maxExpiry)}</dd>
                </div>
                <div>
                  <dt>Approval valid until</dt>
                  <dd>{policyDate(context.data.policy.reviewedUntil)}</dd>
                </div>
              </dl>
              <p>
                Suggestions use the network clock. Acceptance ends before approval expires;
                protection stays within the approved expiry limit. Refreshing data never extends
                approval or changes dates you entered.
              </p>
              <p>
                {local
                  ? 'Local replica limits are separate from mainnet issuer deadlines.'
                  : 'These dates follow the deployed policy. Issuer conversion terms are available in official asset context.'}
              </p>
            </section>
          </InfoPopover>
        )}
      </div>
      <div className={layout.formGrid}>
        <label className={layout.field}>
          <span>Acceptance deadline (UTC)</span>
          <input
            type="datetime-local"
            step="1"
            required
            value={dates.acceptBefore}
            onChange={(event) => terms.setAcceptance(event.target.value)}
          />
        </label>
        <label className={layout.field}>
          <span>Protection expiry (UTC)</span>
          <input
            type="datetime-local"
            step="1"
            required
            value={dates.expiresAt}
            onChange={(event) => terms.setExpiry(event.target.value)}
          />
        </label>
      </div>
      {terms.dateError && (
        <p role="status" className={styles.warning}>
          {terms.dateError}
        </p>
      )}
    </>
  );
}

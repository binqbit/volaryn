import { useState } from 'react';
import {
  formatUnits,
  shortAddress,
  type Asset,
  type Agreement,
  type Wallet,
} from '../lib/api/client';
import type { ActionRequest, Operation } from '../lib/chain/actionTypes';
import { AccountSelect, chooseAccount } from './AccountSelect';
import { date } from './ActionReview';
import { AssetIdentity } from './AssetIdentity';
import { TokenBalance } from './TokenBalance';
import { InfoPopover } from './InfoPopover';
import { ConnectWalletButton } from './wallets/WalletConnection';
import { agreementLifecycle } from './agreementLifecycle';
import { agreementAction } from './agreementAction';
import { agreementPerspective } from './agreementPerspective';
import type { ActivityItem } from './activity/model';
import { OfferSideBadge } from './OfferSideBadge';
import styles from '../App.module.css';
import info from './InfoContent.module.css';

export function AgreementPanel({
  agreement,
  assets,
  owner,
  wallet,
  walletStatus,
  usable,
  now,
  activity,
  onReview,
}: {
  agreement: Agreement;
  assets: Asset[];
  owner: string | undefined;
  wallet: Wallet | undefined;
  walletStatus: string;
  usable: boolean;
  now: bigint | undefined;
  activity: ActivityItem[];
  onReview: (request: ActionRequest) => Promise<void>;
}) {
  const [usdcSelection, setUsdcSelection] = useState('');
  const [assetSelection, setAssetSelection] = useState('');
  const usdcAccounts =
    wallet?.accounts.filter((account) => account.mint === agreement.usdcMint) ?? [];
  const deliveryAccounts =
    wallet?.accounts.filter((account) => account.mint === agreement.underlyingMint) ?? [];
  const usdc = chooseAccount(usdcAccounts, usdcSelection);
  const asset = chooseAccount(deliveryAccounts, assetSelection);
  const symbol = assets.find((item) => item.mint === agreement.underlyingMint)?.symbol ?? 'tokens';
  const active = agreement.status === 'active';
  const completed = agreement.status === 'exercised';
  const open = agreement.status === 'open';
  const isHolder = !!owner && agreement.holder === owner;
  const isWriter = !!owner && agreement.writer === owner;
  const isCreator = !!owner && agreement.creator === owner;
  const request = agreement.side === 'holder';
  const reservedForAnother =
    !!agreement.designatedCounterparty && agreement.designatedCounterparty !== owner;
  const expired = now !== undefined && now >= BigInt(agreement.expiresAt);
  const acceptanceEnded = now !== undefined && now >= BigInt(agreement.acceptBefore);
  const terminal = !active && !open;
  const lifecycle = agreementLifecycle(agreement, now);
  const perspective = agreementPerspective(agreement, owner, now);
  const action = agreementAction(agreement, owner, activity);
  const primaryOperation = active ? 'exercise' : 'activate';
  const primaryProgress = action?.operation === primaryOperation ? action : undefined;
  const primaryAction = (open && !isCreator && !reservedForAnother) || (active && isHolder);
  const canReviewPrimary = primaryAction && !(open ? acceptanceEnded : expired);
  const canCleanup = terminal && (agreement.status === 'cancelled' ? isCreator : isWriter);
  const managementAction = (isCreator && open) || (isWriter && active && expired) || canCleanup;
  const requiredUsdc =
    open && primaryAction ? BigInt(request ? agreement.payout : agreement.premium) : undefined;
  const eligible = !!owner && now !== undefined && !!usdc && usable && !action;
  const actionLabel = (operation: Operation, fallback: string) =>
    action?.operation === operation ? action.label : fallback;
  const deliverable =
    !!asset && BigInt(asset.amountRaw) >= BigInt(agreement.quantityRaw) && !asset.frozen;
  const review = (operation: Exclude<Operation, 'create'>) => {
    if (usdc)
      void onReview({
        operation,
        agreement,
        usdcAccount: usdc.address,
        underlyingAccount: asset?.address,
      });
  };
  return (
    <article className={styles.agreement} aria-label={`Agreement ${agreement.address}`}>
      <div className={styles.cardHeading}>
        <OfferSideBadge side={agreement.side} />
        <p className={styles.eyebrow}>
          {completed
            ? 'SETTLEMENT COMPLETE'
            : active
              ? isHolder
                ? 'YOUR PROTECTION'
                : 'ACTIVE AGREEMENT'
              : open
                ? request
                  ? 'PROTECTION REQUEST · PREMIUM ESCROWED'
                  : 'FUNDED PROTECTION OFFER'
                : 'CLOSED AGREEMENT'}
        </p>
        <span className={styles.status} data-state={lifecycle.open ? 'open' : 'closed'}>
          {lifecycle.label}
        </span>
      </div>
      <p className={styles.smallTag} aria-label="Your agreement role">
        {perspective.role}
      </p>
      <p className={styles.note}>{perspective.description}</p>
      <AssetIdentity assets={assets} mint={agreement.underlyingMint} />
      <div className={styles.payout}>
        <span>Agreed payout</span>
        <strong>
          {formatUnits(agreement.payout)} <small>USDC</small>
        </strong>
        <p>
          For delivery of {formatUnits(agreement.quantityRaw, agreement.underlyingDecimals)}{' '}
          {symbol} (unscaled token units).
        </p>
      </div>
      <dl className={styles.terms}>
        <div>
          <dt>Writer · PreStocks recipient</dt>
          <dd title={agreement.writer ?? undefined}>
            {isWriter ? 'Your wallet · ' : ''}
            {agreement.writer ? shortAddress(agreement.writer) : 'Awaiting provider'}
          </dd>
        </div>
        <div>
          <dt>
            {open && request
              ? 'Requester · future payout recipient'
              : open
                ? 'Eligible holder'
                : agreement.holder
                  ? 'Holder · USDC recipient'
                  : 'Holder'}
          </dt>
          <dd
            title={
              agreement.holder ??
              (open && !request ? (agreement.designatedCounterparty ?? undefined) : undefined)
            }
          >
            {agreement.holder
              ? `${isHolder ? 'Your wallet · ' : ''}${shortAddress(agreement.holder)}`
              : open
                ? agreement.designatedCounterparty
                  ? shortAddress(agreement.designatedCounterparty)
                  : 'Any eligible wallet'
                : 'Not activated'}
          </dd>
        </div>
        <div>
          <dt>Activation premium</dt>
          <dd>{formatUnits(agreement.premium)} USDC</dd>
        </div>
        <div>
          <dt>Acceptance deadline</dt>
          <dd>{date(agreement.acceptBefore)}</dd>
        </div>
        <div>
          <dt>Protection expires</dt>
          <dd>{date(agreement.expiresAt)}</dd>
        </div>
        <div>
          <dt>{open && request ? 'Premium observed in escrow' : 'USDC observed in reserve'}</dt>
          <dd>{formatUnits(agreement.reserveAmount)} USDC</dd>
        </div>
        {completed && (
          <div>
            <dt>Writer's net receipt</dt>
            <dd>
              {formatUnits(agreement.netReceived, agreement.underlyingDecimals)} unscaled tokens
            </dd>
          </div>
        )}
      </dl>
      {owner && canReviewPrimary && (!open || !request) && !action?.complete && (
        <TokenBalance
          symbol={symbol}
          decimals={agreement.underlyingDecimals}
          accounts={wallet ? deliveryAccounts : undefined}
          status={walletStatus}
        >
          {open
            ? `Activation charges only the ${formatUnits(agreement.premium)} USDC premium. Your ${symbol} stays in your wallet until exercise.`
            : `Exercise delivers ${formatUnits(agreement.quantityRaw, agreement.underlyingDecimals)} unscaled ${symbol} from one account and pays you ${formatUnits(agreement.payout)} USDC.`}
        </TokenBalance>
      )}
      {(canReviewPrimary || managementAction) && owner && !action?.complete && (
        <div className={styles.formGrid}>
          <AccountSelect
            label="USDC account"
            accounts={wallet ? usdcAccounts : undefined}
            selected={usdcSelection}
            onChange={setUsdcSelection}
            symbol="USDC"
            decimals={6}
            status={walletStatus}
            required={requiredUsdc}
            requiredLabel={request ? 'Full payout to reserve' : 'Premium to activate'}
          />
          {active && isHolder && !expired && (
            <AccountSelect
              label="Delivery token account"
              accounts={wallet ? deliveryAccounts : undefined}
              selected={assetSelection}
              onChange={setAssetSelection}
              symbol={symbol}
              decimals={agreement.underlyingDecimals}
              status={walletStatus}
              required={BigInt(agreement.quantityRaw)}
              requiredLabel="Quantity to deliver"
              unscaled
            />
          )}
        </div>
      )}
      {!action && (
        <p
          className={styles.actionOutcome}
          data-complete={completed || (active && now !== undefined && !expired) || undefined}
          role="status"
          aria-label="Agreement outcome"
        >
          {perspective.title}
        </p>
      )}
      {primaryAction && (
        <button
          className={styles.primaryButton}
          data-complete={primaryProgress?.complete || undefined}
          disabled={
            !eligible ||
            (active
              ? expired || !deliverable
              : acceptanceEnded || BigInt(usdc?.amountRaw ?? '0') < (requiredUsdc ?? 0n))
          }
          onClick={() => review(primaryOperation)}
        >
          {actionLabel(
            primaryOperation,
            active
              ? expired
                ? 'Protection expired'
                : 'Exercise protection'
              : acceptanceEnded
                ? 'Acceptance ended'
                : request
                  ? 'Fund protection'
                  : 'Activate protection',
          )}
          <span aria-hidden="true">
            {primaryProgress?.complete ? '✓' : primaryProgress ? '…' : eligible ? '↗' : ''}
          </span>
        </button>
      )}
      {active && isHolder && !expired && !deliverable && (
        <p className={styles.note}>
          The selected account must contain the full gross delivery quantity. Balances in other
          accounts are not combined.
        </p>
      )}
      {open && reservedForAnother && owner && !isCreator && (
        <p className={styles.connectHint}>This offer is reserved for another wallet.</p>
      )}
      {isCreator && open && (
        <button
          className={styles.outlineButton}
          data-complete={action?.operation === 'cancel' && action.complete ? true : undefined}
          disabled={!eligible}
          onClick={() => review('cancel')}
        >
          {actionLabel('cancel', request ? 'Cancel request' : 'Cancel offer')}
        </button>
      )}
      {isWriter && active && (
        <button
          className={styles.outlineButton}
          data-complete={action?.operation === 'reclaim' && action.complete ? true : undefined}
          disabled={!eligible || !expired}
          onClick={() => review('reclaim')}
        >
          {actionLabel(
            'reclaim',
            expired ? 'Reclaim expired reserve' : 'Reserve locked until expiry',
          )}
        </button>
      )}
      {canCleanup && (
        <button
          className={styles.outlineButton}
          disabled={!eligible}
          onClick={() => review('cleanup')}
        >
          {actionLabel('cleanup', 'Recover residual funds')}
        </button>
      )}
      {action?.complete && (
        <p className={styles.note}>Updating agreement details after finalization…</p>
      )}
      {!owner && (open || active) && (
        <p className={styles.connectHint}>
          <ConnectWalletButton className={styles.textButton}>Connect a wallet</ConnectWalletButton>{' '}
          to check eligibility. Nothing is activated automatically.
        </p>
      )}
      {now === undefined && !terminal && (
        <p className={styles.note}>
          Waiting for the network clock. Actions are paused until deadlines can be checked.
        </p>
      )}
      <p className={styles.note}>
        Issuer transfer fees reduce the writer's net receipt, not the holder's USDC payout. Issuer
        restrictions can prevent delivery. Before acceptance, the creator can recover the deposit by
        cancelling. After activation, the premium is not refunded when protection expires.
      </p>
      <InfoPopover title="On-chain details" hint={shortAddress(agreement.address)}>
        <section className={info.section}>
          <h3>Agreement accounts</h3>
          <dl className={info.addresses}>
            <div>
              <dt>Agreement</dt>
              <dd>
                <code>{agreement.address}</code>
              </dd>
            </div>
            <div>
              <dt>Reserve account</dt>
              <dd>
                <code>{agreement.reserve}</code>
              </dd>
            </div>
          </dl>
        </section>
        <section className={info.section}>
          <h3>Participants</h3>
          <dl className={info.addresses}>
            <div>
              <dt>{request ? 'Sell request creator' : 'Buy offer creator'}</dt>
              <dd>
                <code>{agreement.creator}</code>
              </dd>
            </div>
            <div>
              <dt>Writer</dt>
              <dd>{agreement.writer ? <code>{agreement.writer}</code> : 'Not accepted'}</dd>
            </div>
            <div>
              <dt>Holder</dt>
              <dd>{agreement.holder ? <code>{agreement.holder}</code> : 'Not accepted'}</dd>
            </div>
            {agreement.designatedCounterparty && (
              <div>
                <dt>Designated counterparty</dt>
                <dd>
                  <code>{agreement.designatedCounterparty}</code>
                </dd>
              </div>
            )}
          </dl>
        </section>
        <section className={info.section}>
          <h3>Settlement</h3>
          <dl className={info.facts}>
            <div>
              <dt>Gross delivery</dt>
              <dd>
                {agreement.quantityRaw}
                <small>base units</small>
              </dd>
            </div>
          </dl>
          {completed && (
            <>
              <dl className={info.addresses}>
                <div>
                  <dt>Delivered token account · writer controlled</dt>
                  <dd>
                    <code>{agreement.settlement}</code>
                  </dd>
                </div>
              </dl>
              <p className={info.note}>
                The asset was delivered and the payout transferred atomically.
              </p>
            </>
          )}
        </section>
      </InfoPopover>
    </article>
  );
}

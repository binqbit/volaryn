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
import { agreementLifecycle } from './agreementLifecycle';
import { agreementAction } from './agreementAction';
import { agreementPerspective } from './agreementPerspective';
import type { ActivityItem } from './activity/model';
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
  const funded = agreement.status === 'funded';
  const isHolder = !!owner && agreement.holder === owner;
  const isWriter = !!owner && agreement.writer === owner;
  const reservedForAnother = !!agreement.designatedHolder && agreement.designatedHolder !== owner;
  const expired = now !== undefined && now >= BigInt(agreement.expiresAt);
  const acceptanceEnded = now !== undefined && now >= BigInt(agreement.acceptBefore);
  const terminal = !active && !funded;
  const lifecycle = agreementLifecycle(agreement, now);
  const perspective = agreementPerspective(agreement, owner, now);
  const action = agreementAction(agreement, owner, activity);
  const holderOperation = active ? 'exercise' : 'activate';
  const holderProgress = action?.operation === holderOperation ? action : undefined;
  const holderAction = (funded && !isWriter && !reservedForAnother) || (active && isHolder);
  const holderCanReview = holderAction && !(funded ? acceptanceEnded : expired);
  const writerAction = isWriter && (funded || (active && expired) || terminal);
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
        <p className={styles.eyebrow}>
          {completed
            ? 'SETTLEMENT COMPLETE'
            : active
              ? isHolder
                ? 'YOUR PROTECTION'
                : 'ACTIVE AGREEMENT'
              : funded
                ? 'FUNDED PROTECTION OFFER'
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
          <dd title={agreement.writer}>
            {isWriter ? 'Your wallet · ' : ''}
            {shortAddress(agreement.writer)}
          </dd>
        </div>
        <div>
          <dt>
            {funded ? 'Eligible holder' : agreement.holder ? 'Holder · USDC recipient' : 'Holder'}
          </dt>
          <dd
            title={
              agreement.holder ?? (funded ? (agreement.designatedHolder ?? undefined) : undefined)
            }
          >
            {agreement.holder
              ? `${isHolder ? 'Your wallet · ' : ''}${shortAddress(agreement.holder)}`
              : funded
                ? agreement.designatedHolder
                  ? shortAddress(agreement.designatedHolder)
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
          <dt>USDC observed in reserve</dt>
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
      {owner && holderCanReview && !action?.complete && (
        <TokenBalance
          symbol={symbol}
          decimals={agreement.underlyingDecimals}
          accounts={wallet ? deliveryAccounts : undefined}
          status={walletStatus}
        >
          {funded
            ? `Activation charges only the ${formatUnits(agreement.premium)} USDC premium. Your ${symbol} stays in your wallet until exercise.`
            : `Exercise delivers ${formatUnits(agreement.quantityRaw, agreement.underlyingDecimals)} unscaled ${symbol} from one account and pays you ${formatUnits(agreement.payout)} USDC.`}
        </TokenBalance>
      )}
      {(holderCanReview || writerAction) && owner && !action?.complete && (
        <div className={styles.formGrid}>
          <AccountSelect
            label="USDC account"
            accounts={wallet ? usdcAccounts : undefined}
            selected={usdcSelection}
            onChange={setUsdcSelection}
            symbol="USDC"
            decimals={6}
            status={walletStatus}
            required={funded && holderAction && !isWriter ? BigInt(agreement.premium) : undefined}
            requiredLabel="Premium to activate"
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
      {holderAction && (
        <button
          className={styles.primaryButton}
          data-complete={holderProgress?.complete || undefined}
          disabled={
            !eligible ||
            (active
              ? expired || !deliverable
              : acceptanceEnded || BigInt(usdc?.amountRaw ?? '0') < BigInt(agreement.premium))
          }
          onClick={() => review(holderOperation)}
        >
          {actionLabel(
            holderOperation,
            active
              ? expired
                ? 'Protection expired'
                : 'Exercise protection'
              : acceptanceEnded
                ? 'Acceptance ended'
                : 'Activate protection',
          )}
          <span aria-hidden="true">
            {holderProgress?.complete ? '✓' : holderProgress ? '…' : eligible ? '↗' : ''}
          </span>
        </button>
      )}
      {active && isHolder && !expired && !deliverable && (
        <p className={styles.note}>
          The selected account must contain the full gross delivery quantity. Balances in other
          accounts are not combined.
        </p>
      )}
      {funded && reservedForAnother && owner && (
        <p className={styles.connectHint}>This offer is reserved for another wallet.</p>
      )}
      {isWriter && funded && (
        <button
          className={styles.outlineButton}
          data-complete={action?.operation === 'cancel' && action.complete ? true : undefined}
          disabled={!eligible}
          onClick={() => review('cancel')}
        >
          {actionLabel('cancel', 'Cancel offer')}
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
      {isWriter && terminal && (
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
      {!owner && (funded || active) && (
        <p className={styles.connectHint}>
          <a href="#wallet">Connect a wallet</a> to check eligibility. Nothing is activated
          automatically.
        </p>
      )}
      {now === undefined && !terminal && (
        <p className={styles.note}>
          Waiting for the network clock. Actions are paused until deadlines can be checked.
        </p>
      )}
      <p className={styles.note}>
        Issuer transfer fees reduce the writer's net receipt, not the holder's USDC payout. Issuer
        restrictions can prevent delivery. The premium is not refunded when protection expires.
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
              <dt>Writer</dt>
              <dd>
                <code>{agreement.writer}</code>
              </dd>
            </div>
            <div>
              <dt>Holder</dt>
              <dd>
                {agreement.holder || (funded && agreement.designatedHolder) ? (
                  <code>{agreement.holder ?? agreement.designatedHolder}</code>
                ) : funded ? (
                  'Any eligible wallet'
                ) : (
                  'Not activated'
                )}
              </dd>
            </div>
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

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
import { Details } from './Details';
import { agreementLifecycle } from './agreementLifecycle';
import styles from '../App.module.css';

export function AgreementPanel({
  agreement,
  assets,
  owner,
  wallet,
  walletStatus,
  usable,
  now,
  onReview,
}: {
  agreement: Agreement;
  assets: Asset[];
  owner: string | undefined;
  wallet: Wallet | undefined;
  walletStatus: string;
  usable: boolean;
  now: bigint | undefined;
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
  const holderAction = (funded && !reservedForAnother) || (active && isHolder);
  const writerAction = isWriter && (funded || (active && expired) || terminal);
  const eligible = !!owner && now !== undefined && !!usdc && usable;
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
      <p className={styles.note}>
        {funded
          ? acceptanceEnded
            ? 'This offer can no longer be accepted. The writer can cancel it to recover the reserved USDC.'
            : 'A writer has reserved the payout. Protection begins only after activation and payment of the premium.'
          : active && expired
            ? 'The exercise window has ended. The writer can now reclaim the reserve.'
            : active && isHolder
              ? 'Your connected wallet is the holder of this agreement.'
              : active
                ? 'Only the holder can exercise this agreement. The writer cannot withdraw an active reserve before expiry.'
                : 'This agreement is closed and remains a public record of its terms and outcome.'}
      </p>
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
          <dt>Writer</dt>
          <dd title={agreement.writer}>
            {isWriter ? 'Your wallet · ' : ''}
            {shortAddress(agreement.writer)}
          </dd>
        </div>
        <div>
          <dt>{funded ? 'Eligible holder' : 'Holder'}</dt>
          <dd title={agreement.holder ?? agreement.designatedHolder ?? undefined}>
            {agreement.holder
              ? `${isHolder ? 'Your wallet · ' : ''}${shortAddress(agreement.holder)}`
              : agreement.designatedHolder
                ? shortAddress(agreement.designatedHolder)
                : funded
                  ? 'Any eligible wallet'
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
              {formatUnits(agreement.netReceived, agreement.underlyingDecimals)} raw-token units
            </dd>
          </div>
        )}
      </dl>
      {owner && holderAction && (
        <TokenBalance
          symbol={symbol}
          decimals={agreement.underlyingDecimals}
          accounts={wallet ? deliveryAccounts : undefined}
          status={walletStatus}
        >
          {funded
            ? `Activation charges only the ${formatUnits(agreement.premium)} USDC premium. Your ${symbol} stays in your wallet until exercise.`
            : `Exercise delivers ${formatUnits(agreement.quantityRaw, agreement.underlyingDecimals)} ${symbol} from one account and pays you ${formatUnits(agreement.payout)} USDC.`}
        </TokenBalance>
      )}
      {(holderAction || writerAction) && owner && (
        <div className={styles.formGrid}>
          <AccountSelect
            label="USDC account"
            accounts={wallet ? usdcAccounts : undefined}
            selected={usdcSelection}
            onChange={setUsdcSelection}
            symbol="USDC"
            decimals={6}
            status={walletStatus}
            required={funded && holderAction ? BigInt(agreement.premium) : undefined}
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
            />
          )}
        </div>
      )}
      {holderAction && (
        <button
          className={styles.primaryButton}
          disabled={
            !eligible ||
            (active
              ? expired || !deliverable
              : acceptanceEnded || BigInt(usdc?.amountRaw ?? '0') < BigInt(agreement.premium))
          }
          onClick={() => review(active ? 'exercise' : 'activate')}
        >
          {active ? 'Exercise protection' : 'Activate protection'}
          <span>↗</span>
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
          disabled={!eligible}
          onClick={() => review('cancel')}
        >
          Cancel offer
        </button>
      )}
      {isWriter && active && (
        <button
          className={styles.outlineButton}
          disabled={!eligible || !expired}
          onClick={() => review('reclaim')}
        >
          Reclaim expired reserve
        </button>
      )}
      {isWriter && terminal && (
        <button
          className={styles.outlineButton}
          disabled={!eligible}
          onClick={() => review('cleanup')}
        >
          Recover residual funds
        </button>
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
      <Details title="On-chain details" hint={shortAddress(agreement.address)}>
        <p>
          Agreement <code>{agreement.address}</code>
        </p>
        <p>
          Writer <code>{agreement.writer}</code>
        </p>
        <p>
          Holder{' '}
          <code>{agreement.holder ?? agreement.designatedHolder ?? 'Any eligible wallet'}</code>
        </p>
        <p>Gross delivery: {agreement.quantityRaw} base units.</p>
        <p>
          Reserve account <code>{agreement.reserve}</code>
        </p>
        {completed && (
          <p>
            The asset was delivered and the payout transferred atomically. The writer controls the
            delivered token account: <code>{agreement.settlement}</code>
          </p>
        )}
      </Details>
    </article>
  );
}

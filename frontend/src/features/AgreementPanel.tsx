import { Link } from 'react-router';
import { formatUnits, shortAddress, type Agreement, type Position } from '../lib/api/client';
import styles from '../App.module.css';

const date = (seconds: string) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: 'UTC',
  }).format(new Date(Number(seconds) * 1000));

export function AgreementPanel({
  agreement,
  owner,
  position,
  usable,
  onAction,
}: {
  agreement: Agreement | undefined;
  owner: string | undefined;
  position: Position | undefined;
  usable: boolean;
  onAction: (
    agreement: Agreement,
    position: Position,
    operation: 'activate' | 'exercise',
  ) => Promise<void>;
}) {
  if (!agreement) return null;
  const active = agreement.status === 'active';
  const completed = agreement.status === 'exercised';
  const funded = agreement.status === 'funded';
  const isHolder = !!owner && agreement.holder === owner;
  const reservedForAnother =
    !!owner && !!agreement.designatedHolder && agreement.designatedHolder !== owner;
  const canAct = !!owner && (active ? isHolder : funded && !reservedForAnother);
  return (
    <>
      <div className={styles.cardHeading}>
        <p className={styles.eyebrow}>
          {completed
            ? 'SETTLEMENT COMPLETE'
            : active
              ? isHolder
                ? 'YOUR ACTIVE PROTECTION'
                : 'ACTIVE AGREEMENT'
              : funded
                ? 'FUNDED PROTECTION OFFER'
                : 'CLOSED AGREEMENT'}
        </p>
        <span className={styles.status}>
          {completed
            ? 'Exercised'
            : active
              ? 'Active'
              : agreement.status === 'funded'
                ? 'Fully funded'
                : agreement.status}
        </span>
      </div>
      <p className={styles.note}>
        {funded
          ? 'A writer has reserved the payout. This offer becomes your protection only after you activate it and pay the premium.'
          : active && !isHolder
            ? owner
              ? 'This agreement belongs to another wallet. Only its holder can exercise it.'
              : 'Only the holder can exercise this agreement. Connect a wallet to check whether it is yours.'
            : active
              ? 'Your connected wallet is the holder of this agreement.'
              : 'This agreement is closed; no protection can be activated or exercised.'}
      </p>
      <div className={styles.payout}>
        <span>Agreed payout</span>
        <strong>
          {formatUnits(agreement.payout)} <small>USDC</small>
        </strong>
        <p>
          For delivery of {formatUnits(agreement.quantityRaw)} raw-token unit (
          {agreement.quantityRaw} base units).
        </p>
      </div>
      <dl className={styles.terms}>
        <div>
          <dt>Writer</dt>
          <dd title={agreement.writer}>{shortAddress(agreement.writer)}</dd>
        </div>
        <div>
          <dt>{funded ? 'Eligible holder' : 'Holder'}</dt>
          <dd title={agreement.holder ?? agreement.designatedHolder ?? undefined}>
            {agreement.holder
              ? `${isHolder ? 'Your wallet · ' : ''}${shortAddress(agreement.holder)}`
              : agreement.designatedHolder
                ? `${owner === agreement.designatedHolder ? 'Your wallet · ' : ''}${shortAddress(agreement.designatedHolder)}`
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
            <dd>{formatUnits(agreement.netReceived)} raw-token units</dd>
          </div>
        )}
      </dl>
      <div className={styles.explanation}>
        <span>↳</span>
        <p>
          {completed
            ? 'The asset was delivered and the reserved payout was transferred atomically. The writer controls the delivered token account.'
            : active
              ? 'The holder chooses whether to exercise and deliver the full quantity before expiry. No additional writer signature is required.'
              : funded
                ? 'After activation, the underlying stays in the holder’s wallet, and the writer cannot reclaim the reserve while protection is active.'
                : 'The agreement remains available as a public record of its terms and outcome.'}
        </p>
      </div>
      <p className={styles.note}>
        Issuer transfer fees reduce the writer's net receipt, not the holder's USDC payout.
        Transfers can still be restricted by the issuer. Premium and network fees are separate
        costs.
      </p>
      {(funded || (active && isHolder)) && (
        <button
          className={styles.primaryButton}
          disabled={!usable || !canAct}
          onClick={() => {
            if (position && canAct)
              void onAction(agreement, position, active ? 'exercise' : 'activate');
          }}
        >
          {active ? 'Exercise protection' : 'Activate protection'}
          <span>↗</span>
        </button>
      )}
      {!owner && (funded || active) && (
        <p className={styles.connectHint}>
          <a href="#wallet">Connect a wallet</a> to check eligibility. Nothing is activated
          automatically.
        </p>
      )}
      {funded && reservedForAnother && (
        <p className={styles.connectHint}>This offer is reserved for another wallet.</p>
      )}
      <Link className={styles.agreementLink} to={`/agreements/${agreement.address}`}>
        Agreement {shortAddress(agreement.address)} ↗
      </Link>
    </>
  );
}

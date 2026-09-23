import { shortAddress, type Asset } from '../lib/api/client';
import styles from '../App.module.css';
import { Details } from './Details';

export function AssetIdentity({
  assets,
  mint,
  compact = false,
}: {
  assets: Asset[];
  mint: string;
  compact?: boolean;
}) {
  const asset = assets.find((item) => item.mint === mint);
  const identityContent = (
    <>
      <p>
        {import.meta.env.MODE === 'localnet' ? 'Local settlement mint' : 'Settlement mint'}{' '}
        <code>{mint}</code>
      </p>
      {asset && (
        <>
          {import.meta.env.MODE === 'localnet' && (
            <p>
              Referenced PreStocks mint (mainnet) <code>{asset.referenceMint}</code>
            </p>
          )}
          <a href={asset.source} target="_blank" rel="noreferrer">
            View on PreStocks ↗
          </a>
          {import.meta.env.MODE === 'localnet' && (
            <p>
              This disposable replica demonstrates the protection flow. It is not issued by
              PreStocks and carries no private-market exposure.
            </p>
          )}
        </>
      )}
    </>
  );
  const identity = asset ? (
    <Details title="Token identity">{identityContent}</Details>
  ) : (
    identityContent
  );
  if (compact) return identity;
  return (
    <div className={styles.contextBar}>
      <span className={styles.assetIcon} aria-hidden="true">
        {asset?.symbol.slice(0, 2) ?? '?'}
      </span>
      <div className={styles.contextIdentity}>
        <strong>{asset?.name ?? shortAddress(mint)}</strong>
        <p>
          {asset?.symbol ?? 'Unlisted asset'}
          {import.meta.env.MODE === 'localnet' && ' · Local demo'}
        </p>
        {identity}
      </div>
    </div>
  );
}

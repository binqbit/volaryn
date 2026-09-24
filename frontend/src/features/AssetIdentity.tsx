import { Link } from 'react-router';
import { shortAddress, type Asset } from '../lib/api/client';
import styles from '../App.module.css';
import { Details } from './Details';
import { InfoPopover } from './InfoPopover';
import info from './InfoContent.module.css';

export function AssetIdentity({
  assets,
  mint,
  compact = false,
  openContextInNewTab = false,
  inline = false,
}: {
  assets: Asset[];
  mint: string;
  compact?: boolean;
  openContextInNewTab?: boolean;
  inline?: boolean;
}) {
  const asset = assets.find((item) => item.mint === mint);
  const identityContent = (
    <>
      <dl className={info.addresses}>
        <div>
          <dt>
            {import.meta.env.MODE === 'localnet' ? 'Local settlement mint' : 'Settlement mint'}
          </dt>
          <dd>
            <code>{mint}</code>
          </dd>
        </div>
        {asset && import.meta.env.MODE === 'localnet' && (
          <div>
            <dt>Referenced PreStocks mint (mainnet)</dt>
            <dd>
              <code>{asset.referenceMint}</code>
            </dd>
          </div>
        )}
      </dl>
      {asset && (
        <>
          <div className={info.links}>
            <a href={asset.source} target="_blank" rel="noreferrer">
              View on PreStocks <span aria-hidden="true">↗</span>
            </a>
            <Link
              to={`/issuer-assets?q=${asset.referenceMint}`}
              target={openContextInNewTab ? '_blank' : undefined}
              rel={openContextInNewTab ? 'noopener noreferrer' : undefined}
            >
              Verified issuer context <span aria-hidden="true">↗</span>
            </Link>
          </div>
          {import.meta.env.MODE === 'localnet' && (
            <p className={info.note}>
              This disposable replica demonstrates the protection flow. It is not issued by
              PreStocks and carries no private-market exposure.
            </p>
          )}
        </>
      )}
    </>
  );
  const identity = asset ? (
    inline ? (
      <Details title="Token identity">{identityContent}</Details>
    ) : (
      <InfoPopover title="Token identity" context={asset.name}>
        {identityContent}
      </InfoPopover>
    )
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

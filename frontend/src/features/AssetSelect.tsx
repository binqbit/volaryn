import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { shortAddress, type Asset } from '../lib/api/client';
import styles from './AssetSelect.module.css';

function searchAssets(assets: Asset[], query: string) {
  const term = query.trim().toLowerCase();
  return assets.filter((asset) =>
    [asset.symbol, asset.name, asset.mint, asset.referenceMint].some((value) =>
      value.toLowerCase().includes(term),
    ),
  );
}

/** Searchable, keyboard-operated selector. The value is always a mint, never a ticker. */
export function AssetSelect({
  assets,
  value,
  onChange,
  allowAll = false,
}: {
  assets: Asset[];
  value: string;
  onChange: (mint: string) => void;
  allowAll?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selected = assets.find((asset) => asset.mint === value);
  const results = searchAssets(assets, query);
  const options = allowAll && !query.trim() ? [null, ...results] : results;
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [id, open, active]);
  const choose = (mint: string) => {
    onChange(mint);
    setOpen(false);
    setQuery('');
    setActive(0);
  };
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActive(
        open
          ? Math.max(0, Math.min(options.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)))
          : 0,
      );
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (options.length) choose(options[active]?.mint ?? '');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setQuery('');
    }
  }
  return (
    <div className={styles.selector}>
      <label htmlFor={id}>PreStocks token</label>
      <div className={styles.inputWrap}>
        <span aria-hidden="true">⌕</span>
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-activedescendant={open && options.length ? `${id}-${active}` : undefined}
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search name, ticker or mint address"
          value={
            open
              ? query
              : selected
                ? `${selected.symbol} · ${selected.name}`
                : allowAll
                  ? 'All PreStocks'
                  : ''
          }
          onFocus={() => {
            setOpen(true);
            setQuery('');
            setActive(0);
          }}
          onClick={() => setOpen(true)}
          onKeyDown={keyDown}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setQuery('');
          }}
        />
        <span aria-hidden="true">⌄</span>
      </div>
      {open && (
        <div className={styles.dropdown}>
          <div
            className={styles.list}
            id={`${id}-options`}
            role="listbox"
            aria-label="PreStocks tokens"
          >
            {options.map((asset, index) => (
              <button
                key={asset?.mint ?? 'all'}
                type="button"
                role="option"
                id={`${id}-${index}`}
                aria-selected={(asset?.mint ?? '') === value}
                tabIndex={-1}
                data-active={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(asset?.mint ?? '')}
              >
                <span className={styles.icon} aria-hidden="true">
                  {asset?.symbol.slice(0, 2) ?? '◇'}
                </span>
                <span>
                  <strong>{asset?.symbol ?? 'All PreStocks'}</strong>
                  <small>{asset?.name ?? 'Browse every supported token'}</small>
                  {asset && (
                    <small>
                      {import.meta.env.MODE === 'localnet' ? 'Local mint' : 'Mint'}{' '}
                      {shortAddress(asset.mint)}
                    </small>
                  )}
                </span>
                <em>
                  {asset
                    ? import.meta.env.MODE === 'localnet'
                      ? 'Local demo'
                      : 'PreStocks'
                    : `${assets.length} assets`}
                </em>
              </button>
            ))}
          </div>
          {!options.length && (
            <p role="status">
              No supported PreStocks match “{query}”. Try a name, ticker or mint address.
            </p>
          )}
        </div>
      )}
      <p id={`${id}-hint`} className={styles.hint}>
        {import.meta.env.MODE === 'localnet'
          ? 'Local replicas of reviewed PreStocks. No mainnet tokens or funds are used.'
          : 'Search supported PreStocks by name, ticker or mint address.'}
      </p>
    </div>
  );
}

import createClient from 'openapi-fetch';
import { address } from '@solana/kit';
import { VOLARYN_PROGRAM_ADDRESS } from '@volaryn/protocol';
import type { components, paths } from './schema';

export const api = createClient<paths>({
  baseUrl: '',
  fetch: (input) => fetch(input, { cache: 'no-store' }),
});
export type Asset = components['schemas']['AssetView'];
export type Deployment = components['schemas']['Deployment'];
export type Agreement = components['schemas']['AgreementView'];
export type Wallet = components['schemas']['WalletView'];
export type TokenAccount = components['schemas']['WalletTokenAccount'];

export function validateDeployment(value: Deployment, buildMode: string): Deployment {
  if (value.mode === 'localnet' && buildMode !== 'localnet')
    throw new Error('This application build cannot open a localnet deployment.');
  if (
    value.schemaVersion !== 2 ||
    value.mode !== 'localnet' ||
    value.fixtureVersion !== 1 ||
    value.programId !== VOLARYN_PROGRAM_ADDRESS
  )
    throw new Error('Unsupported deployment configuration');
  for (const key of [
    value.genesisHash,
    value.programId,
    value.usdcMint,
    value.holder,
    value.writer,
    value.writerUsdc,
    value.authority,
    value.holderUsdc,
  ])
    address(key);
  if (
    !value.assets.length ||
    new Set(value.assets.map((asset) => asset.mint)).size !== value.assets.length
  )
    throw new Error('Invalid deployment assets');
  for (const asset of value.assets) {
    address(asset.mint);
    address(asset.referenceMint);
    if (
      asset.mint === value.usdcMint ||
      asset.mint === asset.referenceMint ||
      !Number.isInteger(asset.decimals) ||
      asset.decimals < 0 ||
      asset.decimals > 18
    )
      throw new Error('Invalid deployment asset identity');
  }
  return value;
}

export function amount(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Invalid base-unit amount');
  const parsed = BigInt(value);
  if (parsed > 18446744073709551615n) throw new Error('Amount exceeds u64');
  return parsed;
}

export function formatUnits(raw: string, decimals = 6): string {
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new Error('Invalid display amount');
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${value / base}${fraction ? `.${fraction}` : ''}`;
}

export function shortAddress(value: string): string {
  return `${value.slice(0, 5)}…${value.slice(-5)}`;
}

/** Decimal user input is never routed through a floating-point number. */
export function parseUnits(value: string, decimals = 6): bigint {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value))
    throw new Error('Enter a positive decimal amount');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error(`Use at most ${decimals} decimal places`);
  return amount(
    (
      BigInt(whole!) * 10n ** BigInt(decimals) +
      BigInt(fraction.padEnd(decimals, '0') || '0')
    ).toString(),
  );
}

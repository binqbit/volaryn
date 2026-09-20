import createClient from 'openapi-fetch';
import { address } from '@solana/kit';
import { VOLARYN_PROGRAM_ADDRESS } from '@volaryn/protocol';
import type { components, paths } from './schema';

export const api = createClient<paths>({
  baseUrl: '',
  fetch: (input) => fetch(input, { cache: 'no-store' }),
});
export type Deployment = components['schemas']['Deployment'];
export type Agreement = components['schemas']['AgreementView'];
export type Position = components['schemas']['PositionView'];

export function validateDeployment(value: Deployment): Deployment {
  if (
    value.schemaVersion !== 1 ||
    value.mode !== 'localnet' ||
    value.fixtureVersion !== 1 ||
    value.programId !== VOLARYN_PROGRAM_ADDRESS
  )
    throw new Error('Unsupported deployment configuration');
  for (const key of [
    value.genesisHash,
    value.programId,
    value.underlyingMint,
    value.usdcMint,
    value.holder,
    value.writer,
    value.writerUsdc,
    value.authority,
    value.holderUsdc,
    value.holderUnderlying,
  ])
    address(key);
  return value;
}

export function amount(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Invalid base-unit amount');
  const parsed = BigInt(value);
  if (parsed > 18446744073709551615n) throw new Error('Amount exceeds u64');
  return parsed;
}

export function formatUnits(raw: string, decimals = 6): string {
  const value = amount(raw);
  const base = 10n ** BigInt(decimals);
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${value / base}${fraction ? `.${fraction}` : ''}`;
}

export function shortAddress(value: string): string {
  return `${value.slice(0, 5)}…${value.slice(-5)}`;
}

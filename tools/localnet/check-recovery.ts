import { fixtureAssets } from './assets';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createSolanaRpc, address } from '@solana/kit';
import type { components } from '../../frontend/src/lib/api/schema';
import { waitFor } from './process';

await waitFor('http://app:8080/health/index');
const config = (await (
  await fetch('http://app:8080/api/config')
).json()) as components['schemas']['Deployment'];
const response = await fetch('http://app:8080/api/agreements');
assert.equal(response.status, 200);
const agreements = ((await response.json()) as components['schemas']['AgreementView'][]).map(
  ({ observedAt: _time, finalizedSlot: _slot, ...agreement }) => agreement,
);
const rpc = createSolanaRpc('http://app:8080/rpc');
const accounts = await rpc
  .getMultipleAccounts(
    [
      config.writerUsdc,
      config.holderUsdc,
      ...(await fixtureAssets()).flatMap((item) => [
        item.holderAccount.address,
        item.writerAccount.address,
      ]),
    ].map(address),
    { encoding: 'base64', commitment: 'finalized' },
  )
  .send();
const state =
  JSON.stringify(
    { config, agreements, accounts: accounts.value },
    (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  ) + '\n';
const path = 'artifacts/recovery.json';
if (process.argv[2] === 'snapshot') await writeFile(path, state);
else if (process.argv[2] === 'verify')
  assert.equal(
    state,
    await readFile(path, 'utf8'),
    'Restart/rebuild changed financial state or deployment identity',
  );
else throw new Error('Expected snapshot or verify');
console.log(`Recovery ${process.argv[2]} completed.`);

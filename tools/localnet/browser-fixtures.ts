import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createSolanaRpc } from '@solana/kit';
import { fetchAllToken } from '@solana-program/token';
import { fetchAllToken as fetchAllAssets } from '@solana-program/token-2022';
import {
  AGREEMENT_DISCRIMINATOR,
  OfferSide,
  VOLARYN_PROGRAM_ADDRESS,
  getCreateOfferInstruction,
  protocolAddresses,
  sendAndFinalize,
} from '@volaryn/protocol';
import type { Agreement, Deployment } from '../../frontend/src/lib/api/client';
import { demoBalances, fixtureAssets, fixtureUnits } from './assets';
import { fixtureSigners, recipe } from './identity';
import { checkLocalManifest } from './manifest';
import { waitFor } from './process';

/** Test harness only: prove ordinary startup is empty before arranging browser scenarios. */
export async function seedBrowserFixtures(rpcUrl: string, applicationUrl: string) {
  for (const [value, hosts] of [
    [rpcUrl, ['127.0.0.1', 'localhost', 'validator']],
    [applicationUrl, ['127.0.0.1', 'localhost', 'app']],
  ] as const) {
    const url = new URL(value);
    assert(url.protocol === 'http:' && hosts.some((host) => host === url.hostname));
  }
  await waitFor(`${applicationUrl}/health/index`);
  const response = await fetch(`${applicationUrl}/api/config`);
  assert.equal(response.status, 200);
  const deployment = (await response.json()) as Deployment;
  const rpc = createSolanaRpc(rpcUrl);
  const genesisHash = await rpc.getGenesisHash().send();
  assert.notEqual(genesisHash, '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
  const keys = await fixtureSigners();
  const assets = await fixtureAssets();
  checkLocalManifest(deployment, {
    ...deployment,
    schemaVersion: 3,
    mode: 'localnet',
    genesisHash,
    programId: VOLARYN_PROGRAM_ADDRESS,
    authority: keys.authority.address,
    upgradeAuthority: keys.authority.address,
    usdcMint: keys.usdc.address,
    assets: assets.map(({ asset }) => asset),
    localnet: {
      fixtureVersion: recipe.version,
      holder: keys.holder.address,
      writer: keys.writer.address,
      holderUsdc: keys.holderUsdc.address,
      writerUsdc: keys.writerUsdc.address,
    },
  });

  const accounts = await rpc
    .getProgramAccounts(VOLARYN_PROGRAM_ADDRESS, {
      encoding: 'base64',
      commitment: 'finalized',
      dataSlice: { offset: 0, length: 8 },
    })
    .send();
  assert.equal(
    accounts.filter(({ account }) =>
      Buffer.from(account.data[0], 'base64').equals(Buffer.from(AGREEMENT_DISCRIMINATOR)),
    ).length,
    0,
    'Ordinary local bootstrap must create no agreements',
  );
  async function list(path: string) {
    const response = await fetch(`${applicationUrl}/api/${path}`, {
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(response.status, 200);
    return (await response.json()) as Agreement[];
  }
  assert.deepEqual(await list('agreements'), [], 'Fresh agreement discovery must be empty');
  assert.deepEqual(await list('offers'), [], 'Fresh offer discovery must be empty');
  const usdc = await fetchAllToken(rpc, [keys.holderUsdc.address, keys.writerUsdc.address], {
    commitment: 'finalized',
  });
  for (const [index, owner] of [keys.holder.address, keys.writer.address].entries()) {
    assert.equal(usdc[index]!.data.owner, owner);
    assert.equal(usdc[index]!.data.mint, keys.usdc.address);
    assert.equal(usdc[index]!.data.amount, demoBalances.usdc);
  }
  const holdings = assets.flatMap(({ asset, holderAccount, writerAccount }) => [
    { address: holderAccount.address, owner: keys.holder.address, asset },
    { address: writerAccount.address, owner: keys.writer.address, asset },
  ]);
  const tokens = await fetchAllAssets(
    rpc,
    holdings.map(({ address }) => address),
    { commitment: 'finalized' },
  );
  for (const [index, { owner, asset }] of holdings.entries()) {
    assert.equal(tokens[index]!.data.owner, owner);
    assert.equal(tokens[index]!.data.mint, asset.mint);
    assert.equal(
      tokens[index]!.data.amount,
      demoBalances.tokenUnits * 10n ** BigInt(asset.decimals),
    );
  }
  console.log('Fresh localnet verified: no offers; both wallets retain full initial balances.');

  const now = await rpc.getBlockTime(await rpc.getSlot({ commitment: 'finalized' }).send()).send();
  assert(now !== null);
  const expected: string[] = [];
  for (const [index, { mint, asset }] of assets.slice(0, 2).entries()) {
    const nonce = BigInt(index + 1);
    const addresses = await protocolAddresses(mint.address, keys.writer.address, nonce);
    await sendAndFinalize(rpc, keys.writer, [
      getCreateOfferInstruction({
        ...addresses,
        creator: keys.writer,
        creatorUsdc: keys.writerUsdc.address,
        underlyingMint: mint.address,
        usdcMint: keys.usdc.address,
        nonce,
        side: OfferSide.Writer,
        designatedCounterparty: keys.holder.address,
        quantityRaw: fixtureUnits(recipe.quantityRaw, asset.decimals),
        payout: BigInt(recipe.payout),
        premium: BigInt(recipe.premium),
        acceptBefore: now + BigInt(recipe.acceptanceSeconds),
        expiresAt: now + BigInt(recipe.protectionSeconds),
      }),
    ]);
    expected.push(addresses.agreement);
  }
  expected.sort();
  const deadline = Date.now() + 90_000;
  while (true) {
    const indexed = (await list('offers')).map(({ address }) => address).sort();
    if (JSON.stringify(indexed) === JSON.stringify(expected)) break;
    assert(Date.now() < deadline, 'Browser scenario offers were not indexed in time');
    await delay(500);
  }
  console.log('Browser scenarios arranged: OPENAI and SPACEX funded offers are indexed.');
}

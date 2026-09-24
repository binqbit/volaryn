import assert from 'node:assert/strict';
import { createSolanaRpc } from '@solana/kit';
import { fetchToken } from '@solana-program/token';
import { fetchToken as fetchAsset } from '@solana-program/token-2022';
import {
  AgreementStatus,
  fetchAgreement,
  getActivateInstruction,
  getCreateOfferInstruction,
  getExerciseInstruction,
  protocolAddresses,
  sendAndFinalize,
} from '@volaryn/protocol';
import { fixtureSigners } from './identity';
import { fixtureAssets } from './assets';

/** Owns a fresh local agreement; calls only the validator, never the application or its proxy. */
export async function independentExercise(rpcUrl: string, applicationUrl: string) {
  let reachable = false;
  try {
    reachable = (
      await fetch(`${applicationUrl}/health/live`, { signal: AbortSignal.timeout(2000) })
    ).ok;
  } catch {
    /* The application must be stopped for this proof. */
  }
  assert.equal(reachable, false, 'The application must be unavailable during independent exercise');
  const rpc = createSolanaRpc(rpcUrl);
  assert.notEqual(
    await rpc.getGenesisHash().send(),
    '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    'Disposable signers must never reach mainnet',
  );
  const keys = await fixtureSigners();
  const asset = (await fixtureAssets()).find((item) => item.asset.symbol === 'ANTHROPIC')!;
  const nonce = 8_000_001n;
  const addresses = await protocolAddresses(asset.mint.address, keys.writer.address, nonce);
  const now = await rpc.getBlockTime(await rpc.getSlot({ commitment: 'finalized' }).send()).send();
  assert(now !== null);
  const quantity = 1_000_000n;
  const payout = 1_000_000n;
  const premium = 100_000n;
  const before = (await fetchToken(rpc, keys.holderUsdc.address)).data.amount;
  await sendAndFinalize(rpc, keys.writer, [
    getCreateOfferInstruction({
      ...addresses,
      writer: keys.writer,
      writerUsdc: keys.writerUsdc.address,
      underlyingMint: asset.mint.address,
      usdcMint: keys.usdc.address,
      nonce,
      designatedHolder: keys.holder.address,
      quantityRaw: quantity,
      payout,
      premium,
      acceptBefore: now + 300n,
      expiresAt: now + 600n,
    }),
  ]);
  await sendAndFinalize(rpc, keys.holder, [
    getActivateInstruction({
      ...addresses,
      holder: keys.holder,
      holderUsdc: keys.holderUsdc.address,
      writerUsdc: keys.writerUsdc.address,
      underlyingMint: asset.mint.address,
      usdcMint: keys.usdc.address,
    }),
  ]);
  // No writer signer participates in exercise and no backend receipt is required by the program.
  await sendAndFinalize(rpc, keys.holder, [
    getExerciseInstruction({
      ...addresses,
      holder: keys.holder,
      holderUsdc: keys.holderUsdc.address,
      holderUnderlying: asset.holderAccount.address,
      underlyingMint: asset.mint.address,
      usdcMint: keys.usdc.address,
    }),
  ]);
  assert.equal(
    (await fetchAgreement(rpc, addresses.agreement)).data.status,
    AgreementStatus.Exercised,
  );
  assert.equal(
    (await fetchToken(rpc, keys.holderUsdc.address)).data.amount,
    before - premium + payout,
  );
  assert.equal((await fetchToken(rpc, addresses.reserve)).data.amount, 0n);
  const receipt = (await fetchAsset(rpc, addresses.settlement)).data;
  assert.equal(receipt.owner, keys.writer.address);
  assert(receipt.amount > 0n && receipt.amount <= quantity);
  console.log(
    'Backend-independent holder exercise, full USDC payout and writer token ownership verified.',
  );
}

if (process.argv[1]?.endsWith('/independent-exercise.ts')) {
  const [rpcUrl, applicationUrl] = process.argv.slice(2);
  if (!rpcUrl || !applicationUrl)
    throw new Error('Expected local RPC URL and stopped application URL');
  await independentExercise(rpcUrl, applicationUrl);
}

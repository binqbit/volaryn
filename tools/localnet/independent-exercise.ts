import assert from 'node:assert/strict';
import { createSolanaRpc } from '@solana/kit';
import { fetchToken } from '@solana-program/token';
import { fetchToken as fetchAsset } from '@solana-program/token-2022';
import {
  AgreementStatus,
  OfferSide,
  fetchAgreement,
  getActivateInstruction,
  getAcceptRequestInstruction,
  getCreateOfferInstruction,
  getExerciseInstruction,
  protocolAddresses,
  sendAndFinalize,
} from '@volaryn/protocol';
import { fixtureSigners } from './identity';
import { fixtureAssets } from './assets';

/** Owns fresh local agreements of both origins; calls only the validator, never the application or its proxy. */
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
  for (const side of [OfferSide.Writer, OfferSide.Holder]) {
    const holderOrigin = side === OfferSide.Holder;
    const creator = holderOrigin ? keys.holder : keys.writer;
    const nonce = 8_000_001n + BigInt(side);
    const addresses = await protocolAddresses(asset.mint.address, creator.address, nonce);
    const now = await rpc
      .getBlockTime(await rpc.getSlot({ commitment: 'finalized' }).send())
      .send();
    assert(now !== null);
    const quantity = 1_000_000n;
    const payout = 1_000_000n;
    const premium = 100_000n;
    const before = (await fetchToken(rpc, keys.holderUsdc.address)).data.amount;
    const writerBefore = (await fetchToken(rpc, keys.writerUsdc.address)).data.amount;
    const tokensBefore = (await fetchAsset(rpc, asset.holderAccount.address)).data.amount;
    await sendAndFinalize(rpc, creator, [
      getCreateOfferInstruction({
        ...addresses,
        creator,
        creatorUsdc: holderOrigin ? keys.holderUsdc.address : keys.writerUsdc.address,
        underlyingMint: asset.mint.address,
        usdcMint: keys.usdc.address,
        nonce,
        side,
        designatedCounterparty: holderOrigin ? keys.writer.address : keys.holder.address,
        quantityRaw: quantity,
        payout,
        premium,
        acceptBefore: now + 300n,
        expiresAt: now + 600n,
      }),
    ]);
    assert.equal(
      (await fetchToken(rpc, addresses.reserve)).data.amount,
      holderOrigin ? premium : payout,
    );
    assert.equal((await fetchAsset(rpc, asset.holderAccount.address)).data.amount, tokensBefore);
    if (holderOrigin) {
      await sendAndFinalize(rpc, keys.writer, [
        getAcceptRequestInstruction({
          ...addresses,
          writer: keys.writer,
          writerUsdc: keys.writerUsdc.address,
          underlyingMint: asset.mint.address,
          usdcMint: keys.usdc.address,
        }),
      ]);
    } else {
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
    }
    assert.equal(
      (await fetchAgreement(rpc, addresses.agreement)).data.status,
      AgreementStatus.Active,
    );
    assert.equal((await fetchToken(rpc, addresses.reserve)).data.amount, payout);
    assert.equal((await fetchToken(rpc, keys.holderUsdc.address)).data.amount, before - premium);
    assert.equal(
      (await fetchToken(rpc, keys.writerUsdc.address)).data.amount,
      writerBefore - payout + premium,
    );
    assert.equal((await fetchAsset(rpc, asset.holderAccount.address)).data.amount, tokensBefore);
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
    assert.equal(
      (await fetchAsset(rpc, asset.holderAccount.address)).data.amount,
      tokensBefore - quantity,
    );
    const receipt = (await fetchAsset(rpc, addresses.settlement)).data;
    assert.equal(receipt.owner, keys.writer.address);
    assert(receipt.amount > 0n && receipt.amount <= quantity);
  }
  console.log(
    'Both offer origins: backend-independent exercise, full USDC payout and writer token ownership verified.',
  );
}

if (process.argv[1]?.endsWith('/independent-exercise.ts')) {
  const [rpcUrl, applicationUrl] = process.argv.slice(2);
  if (!rpcUrl || !applicationUrl)
    throw new Error('Expected local RPC URL and stopped application URL');
  await independentExercise(rpcUrl, applicationUrl);
}

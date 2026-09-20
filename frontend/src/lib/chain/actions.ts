import { address, unwrapOption, type TransactionSigner } from '@solana/kit';
import { fetchToken } from '@solana-program/token';
import { fetchToken as fetchToken2022, fetchMint } from '@solana-program/token-2022';
import {
  AgreementStatus,
  fetchAgreement,
  fetchAssetPolicy,
  getActivateInstruction,
  getExerciseInstruction,
  protocolAddresses,
  prepareTransaction,
} from '@volaryn/protocol';
import { amount, type Agreement, type Deployment, type Position } from '../api/client';
import type { AppClient } from './client';

export async function prepareAction(
  client: AppClient,
  deployment: Deployment,
  view: Agreement,
  position: Position,
  signer: TransactionSigner,
  operation: 'activate' | 'exercise',
) {
  const { rpc } = client;
  if ((await rpc.getGenesisHash().send()) !== deployment.genesisHash)
    throw new Error('Wrong network: the ledger identity changed');
  const { data: agreement } = await fetchAgreement(rpc, address(view.address), {
    commitment: 'confirmed',
  });
  if (
    agreement.version !== 1 ||
    agreement.underlyingMint !== deployment.underlyingMint ||
    agreement.usdcMint !== deployment.usdcMint
  )
    throw new Error('Agreement identity is not supported');
  for (const [actual, displayed] of [
    [agreement.quantityRaw, view.quantityRaw],
    [agreement.premium, view.premium],
    [agreement.payout, view.payout],
  ] as const) {
    if (actual !== amount(displayed))
      throw new Error('Agreement terms changed; refresh before signing');
  }
  const addresses = await protocolAddresses(
    agreement.underlyingMint,
    agreement.writer,
    agreement.nonce,
  );
  if (addresses.agreement !== view.address) throw new Error('Invalid agreement address');
  const slot = await rpc.getSlot({ commitment: 'confirmed' }).send();
  const time = await rpc.getBlockTime(slot).send();
  if (time === null || time >= agreement.expiresAt)
    throw new Error('Protection has expired or chain time is unavailable');
  const [{ data: reserve }, { data: usdc }, { data: underlying }, { data: mint }] =
    await Promise.all([
      fetchToken(rpc, addresses.reserve, { commitment: 'confirmed' }),
      fetchToken(rpc, address(position.usdcTokenAccount), { commitment: 'confirmed' }),
      fetchToken2022(rpc, address(position.tokenAccount), { commitment: 'confirmed' }),
      fetchMint(rpc, agreement.underlyingMint, { commitment: 'confirmed' }),
    ]);
  if (
    reserve.owner !== addresses.agreement ||
    reserve.mint !== agreement.usdcMint ||
    reserve.amount < agreement.payout
  )
    throw new Error('The full payout is not available in reserve');
  if (
    usdc.owner !== signer.address ||
    usdc.mint !== agreement.usdcMint ||
    underlying.owner !== signer.address ||
    underlying.mint !== agreement.underlyingMint
  )
    throw new Error('Wallet/token account mismatch');
  if (operation === 'activate') {
    const { data: policy } = await fetchAssetPolicy(rpc, addresses.policy, {
      commitment: 'confirmed',
    });
    if (
      agreement.status !== AgreementStatus.Funded ||
      time >= agreement.acceptBefore ||
      !policy.enabled ||
      time >= policy.reviewedUntil ||
      agreement.expiresAt > policy.maxExpiry
    )
      throw new Error('The offer is no longer eligible');
    const designated = unwrapOption(agreement.designatedHolder);
    if (designated && designated !== signer.address)
      throw new Error('This offer is reserved for another wallet');
    if (usdc.amount < agreement.premium) throw new Error('Insufficient USDC for the premium');
  } else if (
    agreement.status !== AgreementStatus.Active ||
    unwrapOption(agreement.holder) !== signer.address ||
    underlying.amount < agreement.quantityRaw
  ) {
    throw new Error('Exercise requires the active holder and the full deliverable quantity');
  }
  // Mint decoding validates the same exact token identity used by the instruction.
  if (mint.decimals !== 6) throw new Error('Unsupported asset precision');
  const instruction =
    operation === 'activate'
      ? getActivateInstruction({
          ...addresses,
          holder: signer,
          underlyingMint: agreement.underlyingMint,
          usdcMint: agreement.usdcMint,
          holderUsdc: address(position.usdcTokenAccount),
          writerUsdc: address(deployment.writerUsdc),
        })
      : getExerciseInstruction({
          ...addresses,
          holder: signer,
          underlyingMint: agreement.underlyingMint,
          usdcMint: agreement.usdcMint,
          holderUsdc: address(position.usdcTokenAccount),
          holderUnderlying: address(position.tokenAccount),
        });
  return prepareTransaction(rpc, signer, [instruction]);
}

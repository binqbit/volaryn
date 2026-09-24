import { address } from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { fetchAssetPolicy, findPolicyPda, VOLARYN_PROGRAM_ADDRESS } from '@volaryn/protocol';
import type { Asset, Deployment } from '../api/client';
import type { AppClient } from './client';

export interface OfferContext {
  mint: string;
  now: bigint;
  policy: {
    enabled: boolean;
    reviewedUntil: bigint;
    maxExpiry: bigint;
  };
}

async function confirmedTime(client: AppClient, signal?: AbortSignal) {
  const slot = await client.rpc.getSlot({ commitment: 'confirmed' }).send({ abortSignal: signal });
  const now = await client.rpc.getBlockTime(slot).send({ abortSignal: signal });
  if (now === null) throw new Error('Validator clock is unavailable');
  return now;
}

/** Suggestions use the selected deployment's policy, including for local token replicas. */
export async function loadOfferContext(
  client: AppClient,
  deployment: Deployment,
  asset: Asset,
  signal?: AbortSignal,
): Promise<OfferContext> {
  signal?.throwIfAborted();
  if (deployment.programId !== VOLARYN_PROGRAM_ADDRESS)
    throw new Error('Unsupported deployment program');
  if ((await client.rpc.getGenesisHash().send({ abortSignal: signal })) !== deployment.genesisHash)
    throw new Error('Wrong network: the ledger identity changed');

  const mint = address(asset.mint);
  const [policyAddress] = await findPolicyPda({ mint });
  const [policy, now] = await Promise.all([
    fetchAssetPolicy(client.rpc, policyAddress, {
      commitment: 'confirmed',
      abortSignal: signal,
    }),
    confirmedTime(client, signal),
  ]);
  if (
    policy.programAddress !== VOLARYN_PROGRAM_ADDRESS ||
    policy.data.mint !== mint ||
    policy.data.tokenProgram !== TOKEN_2022_PROGRAM_ADDRESS ||
    policy.data.decimals !== asset.decimals
  )
    throw new Error('The asset policy does not match the selected token');

  return {
    mint,
    now,
    policy: {
      enabled: policy.data.enabled,
      reviewedUntil: policy.data.reviewedUntil,
      maxExpiry: policy.data.maxExpiry,
    },
  };
}

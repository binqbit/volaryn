import { describe, expect, it } from 'vitest';
import {
  address,
  createSolanaRpcFromTransport,
  getBase64Decoder,
  type RpcTransport,
} from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import {
  findPolicyPda,
  getAssetPolicyEncoder,
  VOLARYN_PROGRAM_ADDRESS,
  type AssetPolicyArgs,
} from '@volaryn/protocol';
import type { Asset, Deployment } from '../api/client';
import type { AppClient } from './client';
import { loadOfferContext } from './offerContext';

const mint = address('11111111111111111111111111111111');
const asset: Asset = {
  mint,
  referenceMint: TOKEN_2022_PROGRAM_ADDRESS,
  decimals: 9,
  name: 'Test asset',
  symbol: 'TEST',
  source: 'localnet',
};
const deployment: Deployment = {
  schemaVersion: 3,
  genesisHash: mint,
  programId: VOLARYN_PROGRAM_ADDRESS,
  programSha256: '',
  programLength: 1,
  mode: 'localnet',
  authority: mint,
  usdcMint: TOKEN_2022_PROGRAM_ADDRESS,
  assets: [asset],
};
const policy: AssetPolicyArgs = {
  mint,
  tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  decimals: 9,
  version: 1,
  enabled: true,
  reviewedUntil: 2_000n,
  maxExpiry: 3_000n,
};

function fixture(
  options: {
    policy?: Partial<AssetPolicyArgs>;
    owner?: string;
    genesisHash?: string;
    now?: number | null;
    missingPolicy?: boolean;
  } = {},
) {
  const calls: { method: string; params: unknown[]; signal?: AbortSignal }[] = [];
  const encoded = getBase64Decoder().decode(
    getAssetPolicyEncoder().encode({ ...policy, ...options.policy }),
  );
  const transport: RpcTransport = async <TResponse>({
    payload,
    signal,
  }: Parameters<RpcTransport>[0]) => {
    const request = payload as { method: string; params: unknown[] };
    calls.push({ ...request, signal });
    const result = (() => {
      switch (request.method) {
        case 'getGenesisHash':
          return options.genesisHash ?? deployment.genesisHash;
        case 'getSlot':
          return 500;
        case 'getBlockTime':
          return options.now === undefined ? 1_000 : options.now;
        case 'getAccountInfo':
          return {
            context: { slot: 500 },
            value: options.missingPolicy
              ? null
              : {
                  data: [encoded, 'base64'],
                  executable: false,
                  lamports: 1,
                  owner: options.owner ?? VOLARYN_PROGRAM_ADDRESS,
                  rentEpoch: 0,
                  space: 94,
                },
          };
        default:
          throw new Error(`Unexpected RPC method: ${request.method}`);
      }
    })();
    return { jsonrpc: '2.0', id: 1, result } as TResponse;
  };
  const client = { rpc: createSolanaRpcFromTransport(transport) } as AppClient;
  return { client, calls };
}

describe('offer context', () => {
  it('uses the deployed token policy and confirmed chain time', async () => {
    const { client, calls } = fixture();
    const signal = new AbortController().signal;
    expect(await loadOfferContext(client, deployment, asset, signal)).toEqual({
      mint,
      now: 1_000n,
      policy: { enabled: true, reviewedUntil: 2_000n, maxExpiry: 3_000n },
    });
    const [policyAddress] = await findPolicyPda({ mint });
    expect(calls.find((call) => call.method === 'getAccountInfo')?.params).toEqual([
      policyAddress,
      { commitment: 'confirmed', encoding: 'base64' },
    ]);
    expect(calls.find((call) => call.method === 'getSlot')?.params).toEqual([
      { commitment: 'confirmed' },
    ]);
    expect(calls.find((call) => call.method === 'getBlockTime')?.params).toEqual([500n]);
    expect(calls.every((call) => call.signal === signal)).toBe(true);
  });

  it.each([
    { owner: mint },
    { policy: { mint: TOKEN_2022_PROGRAM_ADDRESS } },
    { policy: { tokenProgram: mint } },
    { policy: { decimals: 6 } },
  ])('rejects a policy identity mismatch: %j', async (options) => {
    const { client } = fixture(options);
    await expect(loadOfferContext(client, deployment, asset)).rejects.toThrow(
      'The asset policy does not match the selected token',
    );
  });

  it('rejects a changed ledger before reading policy data', async () => {
    const { client, calls } = fixture({ genesisHash: TOKEN_2022_PROGRAM_ADDRESS });
    await expect(loadOfferContext(client, deployment, asset)).rejects.toThrow('Wrong network');
    expect(calls.map((call) => call.method)).toEqual(['getGenesisHash']);
  });

  it('rejects a deployment for a different program', async () => {
    const { client, calls } = fixture();
    await expect(
      loadOfferContext(client, { ...deployment, programId: mint }, asset),
    ).rejects.toThrow('Unsupported deployment program');
    expect(calls).toHaveLength(0);
  });

  it('preserves disabled and expired policy state for an explanation in the form', async () => {
    const { client } = fixture({
      policy: { enabled: false, reviewedUntil: 999n, maxExpiry: 900n },
    });
    expect(await loadOfferContext(client, deployment, asset)).toEqual({
      mint,
      now: 1_000n,
      policy: { enabled: false, reviewedUntil: 999n, maxExpiry: 900n },
    });
  });

  it('preserves the unrestricted local policy without using the mainnet reference mint', async () => {
    const limit = 9_223_372_036_854_775_807n;
    const { client } = fixture({ policy: { reviewedUntil: limit, maxExpiry: limit } });
    expect((await loadOfferContext(client, deployment, asset)).policy.maxExpiry).toBe(limit);
  });

  it('rejects missing chain time instead of substituting the browser clock', async () => {
    const { client } = fixture({ now: null });
    await expect(loadOfferContext(client, deployment, asset)).rejects.toThrow(
      'Validator clock is unavailable',
    );
  });

  it('rejects a missing policy', async () => {
    const { client } = fixture({ missingPolicy: true });
    await expect(loadOfferContext(client, deployment, asset)).rejects.toThrow();
  });

  it('does not issue RPC requests after cancellation', async () => {
    const { client, calls } = fixture();
    const controller = new AbortController();
    controller.abort(new Error('Selection changed'));
    await expect(loadOfferContext(client, deployment, asset, controller.signal)).rejects.toThrow(
      'Selection changed',
    );
    expect(calls).toHaveLength(0);
  });
});

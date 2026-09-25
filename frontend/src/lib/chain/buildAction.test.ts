import { describe, expect, it } from 'vitest';
import {
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpcFromTransport,
  type Address,
  type ReadonlyUint8Array,
  type RpcTransport,
} from '@solana/kit';
import { AccountState, getTokenEncoder, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { getMintEncoder, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import {
  AgreementStatus,
  OfferSide,
  getAgreementEncoder,
  protocolAddresses,
  VOLARYN_PROGRAM_ADDRESS,
} from '@volaryn/protocol';
import type { Agreement, Deployment } from '../api/client';
import type { ActionRequest, Operation } from './actionTypes';
import type { AppClient } from './client';
import { buildAction } from './buildAction';

async function fixture({
  operation,
  side = 'writer',
  status = operation === 'cleanup'
    ? 'cancelled'
    : operation === 'reclaim' || operation === 'exercise'
      ? 'active'
      : 'open',
}: {
  operation: Operation;
  side?: Agreement['side'];
  status?: 'open' | 'active' | 'exercised' | 'cancelled' | 'expired';
}) {
  const [writer, holder, mint, usdcMint, usdcAccount] = await Promise.all(
    [1, 2, 3, 4, 5].map((seed) =>
      createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(seed)),
    ),
  );
  const creator = side === 'holder' ? holder! : writer!;
  const signer =
    operation === 'activate'
      ? side === 'holder'
        ? writer!
        : holder!
      : operation === 'exercise'
        ? holder!
        : operation === 'reclaim' || (operation === 'cleanup' && status !== 'cancelled')
          ? writer!
          : creator;
  const addresses = await protocolAddresses(mint!.address, creator.address, 1n);
  const reserveAmount = status === 'open' && side === 'holder' ? '500000' : '20000000';
  const agreement: Agreement = {
    address: addresses.agreement,
    version: 2,
    creator: creator.address,
    side,
    writer: status === 'open' && side === 'holder' ? null : writer!.address,
    holder: status === 'open' && side === 'writer' ? null : holder!.address,
    designatedCounterparty: null,
    underlyingMint: mint!.address,
    underlyingDecimals: 9,
    underlyingProgram: TOKEN_2022_PROGRAM_ADDRESS,
    usdcMint: usdcMint!.address,
    quantityRaw: '1000000000',
    payout: '20000000',
    premium: '500000',
    acceptBefore: '2000',
    expiresAt: '3000',
    status,
    policyVersion: 1,
    reserve: addresses.reserve,
    reserveAmount,
    settlement: addresses.settlement,
    netReceived: '0',
    finalizedSlot: '42',
    observedAt: 1000,
  };
  const deployment: Deployment = {
    schemaVersion: 3,
    mode: 'localnet',
    genesisHash: writer!.address,
    programId: VOLARYN_PROGRAM_ADDRESS,
    programSha256: '0'.repeat(64),
    programLength: 1,
    authority: writer!.address,
    usdcMint: usdcMint!.address,
    assets: [
      {
        mint: mint!.address,
        referenceMint: mint!.address,
        decimals: 9,
        name: 'Test asset',
        symbol: 'TEST',
        source: 'localnet',
      },
    ],
  };
  const accounts = new Map<string, { owner: Address; bytes: ReadonlyUint8Array }>();
  const token = (owner: Address, amount: bigint) =>
    getTokenEncoder().encode({
      mint: usdcMint!.address,
      owner,
      amount,
      delegate: null,
      state: AccountState.Initialized,
      isNative: null,
      delegatedAmount: 0n,
      closeAuthority: null,
    });
  accounts.set(usdcAccount!.address, {
    owner: TOKEN_PROGRAM_ADDRESS,
    bytes: token(signer.address, 100000000n),
  });
  accounts.set(addresses.reserve, {
    owner: TOKEN_PROGRAM_ADDRESS,
    bytes: token(addresses.agreement, BigInt(reserveAmount)),
  });
  accounts.set(addresses.agreement, {
    owner: VOLARYN_PROGRAM_ADDRESS,
    bytes: getAgreementEncoder().encode({
      version: 2,
      bump: 1,
      creator: creator.address,
      side: side === 'holder' ? OfferSide.Holder : OfferSide.Writer,
      writer: agreement.writer as Address | null,
      holder: agreement.holder as Address | null,
      nonce: 1n,
      designatedCounterparty: null,
      underlyingMint: mint!.address,
      underlyingProgram: TOKEN_2022_PROGRAM_ADDRESS,
      underlyingDecimals: 9,
      usdcMint: usdcMint!.address,
      usdcProgram: TOKEN_PROGRAM_ADDRESS,
      quantityRaw: 1000000000n,
      payout: 20000000n,
      premium: 500000n,
      acceptBefore: 2000n,
      expiresAt: 3000n,
      policyVersion: 1,
      createdAt: 500n,
      activatedAt: null,
      settledAt: null,
      netReceived: 0n,
      status: {
        open: AgreementStatus.Open,
        active: AgreementStatus.Active,
        exercised: AgreementStatus.Exercised,
        cancelled: AgreementStatus.Cancelled,
        expired: AgreementStatus.Expired,
      }[status],
    }),
  });
  accounts.set(mint!.address, {
    owner: TOKEN_2022_PROGRAM_ADDRESS,
    bytes: getMintEncoder().encode({
      mintAuthority: null,
      supply: 10000000000n,
      decimals: 9,
      isInitialized: true,
      freezeAuthority: null,
      extensions: null,
    }),
  });
  const calls: { method: string; params: unknown[] }[] = [];
  const transport: RpcTransport = async <TResponse>({ payload }: Parameters<RpcTransport>[0]) => {
    const request = payload as { method: string; params: unknown[] };
    calls.push(request);
    const result = (() => {
      switch (request.method) {
        case 'getGenesisHash':
          return deployment.genesisHash;
        case 'getSlot':
          return 42;
        // A clock outage must not prevent a state-only refund review.
        case 'getBlockTime':
          return null;
        case 'getAccountInfo': {
          const account = accounts.get(request.params[0] as string);
          if (!account) throw new Error(`Unexpected account: ${request.params[0]}`);
          return {
            context: { slot: 42 },
            value: {
              owner: account.owner,
              data: [Buffer.from(account.bytes).toString('base64'), 'base64'],
              lamports: 1000000,
              executable: false,
              rentEpoch: 0,
              space: account.bytes.length,
            },
          };
        }
        case 'getEpochInfo':
          return { absoluteSlot: 42, blockHeight: 42, epoch: 1, slotIndex: 42, slotsInEpoch: 100 };
        case 'getLatestBlockhash':
          return {
            context: { slot: 42 },
            value: { blockhash: deployment.genesisHash, lastValidBlockHeight: 100 },
          };
        case 'getFeeForMessage':
          return { context: { slot: 42 }, value: 5000 };
        case 'getBalance':
          return { context: { slot: 42 }, value: 1000000000 };
        default:
          throw new Error(`Unexpected RPC method: ${request.method}`);
      }
    })();
    return { jsonrpc: '2.0', id: 1, result } as TResponse;
  };
  const client = { rpc: createSolanaRpcFromTransport(transport) } as AppClient;
  const request: ActionRequest =
    operation === 'create'
      ? {
          operation,
          usdcAccount: usdcAccount!.address,
          terms: { ...agreement, nonce: '2', designatedCounterparty: null },
        }
      : { operation, usdcAccount: usdcAccount!.address, agreement };
  return { client, deployment, request, signer, calls, mint: mint!.address };
}

describe('action review clock requirements', () => {
  for (const side of ['holder', 'writer'] as const) {
    it.each([
      { operation: 'cancel', status: 'open' },
      { operation: 'cleanup', status: 'cancelled' },
      { operation: 'cleanup', status: 'exercised' },
      { operation: 'cleanup', status: 'expired' },
    ] as const)(
      `${side} $operation of $status can be reviewed without a chain clock`,
      async ({ operation, status }) => {
        const f = await fixture({ operation, status, side });
        const plan = await buildAction(f.client, f.deployment, f.request, f.signer);
        expect(plan.instructions).toHaveLength(1);
        expect(plan.review).toMatchObject({
          operation,
          side,
          owner: f.signer.address,
          escrowAmount: side === 'holder' && operation === 'cancel' ? '500000' : '20000000',
          networkFee: '5000',
          accountRent: '0',
          acceptBefore: '2000',
          expiresAt: '3000',
        });
        expect(
          f.calls.some(({ method }) => method === 'getSlot' || method === 'getBlockTime'),
        ).toBe(false);
        expect(
          f.calls.some(({ method, params }) => method === 'getAccountInfo' && params[0] === f.mint),
        ).toBe(false);
      },
    );
  }

  it.each(['create', 'activate', 'exercise', 'reclaim'] as const)(
    '%s still requires chain time and fails closed when it is unavailable',
    async (operation) => {
      const f = await fixture({ operation });
      await expect(buildAction(f.client, f.deployment, f.request, f.signer)).rejects.toThrow(
        'Validator clock is unavailable',
      );
      expect(f.calls.filter(({ method }) => method === 'getBlockTime')).toHaveLength(1);
      expect(f.calls.some(({ method }) => method === 'getFeeForMessage')).toBe(false);
    },
  );

  it.each([
    { operation: 'cancel', status: 'active', error: 'Only an unaccepted offer can be cancelled' },
    {
      operation: 'cleanup',
      status: 'active',
      error: 'Residual recovery requires a terminal agreement',
    },
  ] as const)(
    '$operation still requires the permitted agreement state',
    async ({ operation, status, error }) => {
      const f = await fixture({ operation, status });
      await expect(buildAction(f.client, f.deployment, f.request, f.signer)).rejects.toThrow(error);
      expect(f.calls.some(({ method }) => method === 'getBlockTime')).toBe(false);
    },
  );
});

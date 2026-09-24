import { describe, expect, it } from 'vitest';
import {
  address,
  createSolanaRpcFromTransport,
  none,
  some,
  type Address,
  type RpcTransport,
} from '@solana/kit';
import {
  AgreementStatus,
  OfferSide,
  getAgreementEncoder,
  protocolAddresses,
  VOLARYN_PROGRAM_ADDRESS,
} from '@volaryn/protocol';
import type { Operation } from '../lib/chain/actionTypes';
import type { PendingTransaction } from './pending';
import { observeAction } from './reconcile';

const owner = address('11111111111111111111111111111111');
const other = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
async function fixture({
  status = AgreementStatus.Active as AgreementStatus,
  activated = true,
  holder = owner as Address,
  writer = other as Address,
  side = 'writer' as 'writer' | 'holder',
  version = 2,
  program = VOLARYN_PROGRAM_ADDRESS as Address,
  history = null as unknown,
  height = 101,
  operation = 'activate' as Operation,
} = {}) {
  const creator = side === 'holder' ? holder : writer;
  const accounts = await protocolAddresses(owner, creator, 1n);
  const pending: PendingTransaction = {
    side,
    actorRole:
      operation === 'activate'
        ? side === 'holder'
          ? 'writer'
          : 'holder'
        : operation === 'create' || operation === 'cancel'
          ? side
          : operation === 'exercise'
            ? 'holder'
            : 'writer',
    signature: '1'.repeat(64),
    lastValidBlockHeight: '100',
    owner,
    agreement: accounts.agreement,
    operation,
  };
  const bytes = getAgreementEncoder().encode({
    version,
    bump: 1,
    creator,
    side: side === 'holder' ? OfferSide.Holder : OfferSide.Writer,
    writer: status === AgreementStatus.Open && side === 'holder' ? none() : some(writer),
    nonce: 1n,
    designatedCounterparty: none(),
    holder: status === AgreementStatus.Open && side === 'writer' ? none() : some(holder),
    underlyingMint: owner,
    underlyingProgram: other,
    underlyingDecimals: 6,
    usdcMint: owner,
    usdcProgram: other,
    quantityRaw: 10n,
    payout: 20n,
    premium: 1n,
    acceptBefore: 1000n,
    expiresAt: 2000n,
    policyVersion: 1,
    createdAt: 1n,
    activatedAt: activated ? some(2n) : none(),
    settledAt: none(),
    netReceived: 0n,
    status,
  });
  let reads = 0;
  const transport: RpcTransport = async <TResponse>({ payload }: Parameters<RpcTransport>[0]) => {
    const { method, params } = payload as { method: string; params: unknown[] };
    let result: unknown;
    switch (method) {
      case 'getSignatureStatuses':
        result = { context: { slot: 90 }, value: [history] };
        break;
      case 'getBlockHeight':
        result = height;
        break;
      case 'getEpochInfo':
        result = {
          absoluteSlot: 150,
          blockHeight: height,
          epoch: 1,
          slotIndex: 1,
          slotsInEpoch: 200,
        };
        break;
      case 'getAccountInfo':
        reads++;
        expect(params[1]).toMatchObject({ minContextSlot: 150n });
        // Kit omits finalized, Solana RPC's default commitment.
        expect((params[1] as { commitment?: string }).commitment ?? 'finalized').toBe('finalized');
        result = {
          context: { slot: 150 },
          value: {
            owner: program,
            lamports: 1000,
            executable: false,
            data: [Buffer.from(bytes).toString('base64'), 'base64'],
            space: bytes.length,
          },
        };
        break;
      default:
        throw new Error(`Unexpected method ${method}`);
    }
    return { jsonrpc: '2.0', id: 1, result } as TResponse;
  };
  return { rpc: createSolanaRpcFromTransport(transport), pending, reads: () => reads };
}

describe('expired action reconciliation', () => {
  it.each([
    { status: AgreementStatus.Open, activated: false, expected: 'expired' },
    { status: AgreementStatus.Cancelled, activated: false, expected: 'expired' },
    { status: AgreementStatus.Active, expected: 'reconciled' },
    { status: AgreementStatus.Exercised, expected: 'reconciled' },
    { status: AgreementStatus.Active, holder: other, expected: 'expired' },
  ])('uses monotonic activation history for $status', async ({ expected, ...options }) => {
    const { rpc, pending } = await fixture(options);
    expect(await observeAction(rpc, pending)).toBe(expected);
  });
  it.each([
    { status: AgreementStatus.Active, expected: 'expired' },
    { status: AgreementStatus.Expired, expected: 'expired' },
    { status: AgreementStatus.Exercised, expected: 'reconciled' },
    { status: AgreementStatus.Open, expected: 'unresolved' },
    { status: AgreementStatus.Exercised, holder: other, expected: 'unresolved' },
  ])(
    'reconciles exercise only for the original holder: $status',
    async ({ expected, ...options }) => {
      const { rpc, pending } = await fixture({ ...options, operation: 'exercise' });
      expect(await observeAction(rpc, pending)).toBe(expected);
    },
  );
  it('keeps unexpired and provisional signatures tracked without declaring expiry', async () => {
    const live = await fixture({ height: 100 });
    expect(await observeAction(live.rpc, live.pending)).toBe('pending');
    expect(live.reads()).toBe(0);
    const provisional = await fixture({ history: { confirmationStatus: 'confirmed', err: null } });
    expect(await observeAction(provisional.rpc, provisional.pending)).toBe('provisional');
    expect(provisional.reads()).toBe(0);
  });
  it('rejects unsupported versions and wrong program ownership', async () => {
    for (const options of [{ version: 3 }, { program: other }]) {
      const { rpc, pending } = await fixture(options);
      await expect(observeAction(rpc, pending)).rejects.toThrow(
        'Agreement identity is unsupported',
      );
    }
  });
});

describe('writer action reconciliation', () => {
  it.each([
    { operation: 'cancel' as const, status: AgreementStatus.Cancelled, expected: 'reconciled' },
    { operation: 'cancel' as const, status: AgreementStatus.Active, expected: 'expired' },
    { operation: 'reclaim' as const, status: AgreementStatus.Expired, expected: 'reconciled' },
    { operation: 'reclaim' as const, status: AgreementStatus.Active, expected: 'expired' },
    { operation: 'cleanup' as const, status: AgreementStatus.Exercised, expected: 'unresolved' },
  ])('checks $operation against terminal chain state $status', async ({ expected, ...options }) => {
    const { rpc, pending } = await fixture({ ...options, writer: owner, holder: other });
    expect(await observeAction(rpc, pending)).toBe(expected);
  });
  it('reconciles creation only when immutable terms match the saved request', async () => {
    const { rpc, pending } = await fixture({ operation: 'create', writer: owner, holder: other });
    expect(await observeAction(rpc, pending)).toBe('unresolved');
    pending.createdTerms = {
      side: 'writer',
      nonce: '1',
      underlyingMint: owner,
      quantityRaw: '10',
      payout: '20',
      premium: '1',
      acceptBefore: '1000',
      expiresAt: '2000',
      designatedCounterparty: null,
    };
    expect(await observeAction(rpc, pending)).toBe('reconciled');
    pending.createdTerms.underlyingMint = other;
    expect(await observeAction(rpc, pending)).toBe('unresolved');
    pending.createdTerms.underlyingMint = owner;
    pending.createdTerms.payout = '21';
    expect(await observeAction(rpc, pending)).toBe('unresolved');
  });
});

describe('holder-origin recovery', () => {
  it.each([
    { status: AgreementStatus.Open, activated: false, expected: 'expired' },
    { status: AgreementStatus.Cancelled, activated: false, expected: 'expired' },
    { status: AgreementStatus.Active, expected: 'reconciled' },
    { status: AgreementStatus.Exercised, expected: 'reconciled' },
    { status: AgreementStatus.Expired, expected: 'reconciled' },
  ])(
    'proves acceptance from the assigned provider in state $status',
    async ({ expected, ...options }) => {
      const { rpc, pending } = await fixture({
        ...options,
        side: 'holder',
        writer: owner,
        holder: other,
      });
      expect(pending.actorRole).toBe('writer');
      expect(await observeAction(rpc, pending)).toBe(expected);
    },
  );

  it('does not attribute another provider’s acceptance to the requester', async () => {
    const { rpc, pending } = await fixture({ side: 'holder', holder: owner, writer: other });
    expect(await observeAction(rpc, pending)).toBe('expired');
  });

  it('recovers a requester cancellation without assigning a writer', async () => {
    const { rpc, pending } = await fixture({
      side: 'holder',
      status: AgreementStatus.Cancelled,
      operation: 'cancel',
      activated: false,
    });
    expect(pending.actorRole).toBe('holder');
    expect(await observeAction(rpc, pending)).toBe('reconciled');
  });

  it('proves holder creation using immutable creator, side and complete terms', async () => {
    const { rpc, pending } = await fixture({
      side: 'holder',
      status: AgreementStatus.Open,
      activated: false,
      operation: 'create',
    });
    pending.createdTerms = {
      side: 'holder',
      nonce: '1',
      underlyingMint: owner,
      quantityRaw: '10',
      payout: '20',
      premium: '1',
      acceptBefore: '1000',
      expiresAt: '2000',
      designatedCounterparty: null,
    };
    expect(await observeAction(rpc, pending)).toBe('reconciled');
    pending.createdTerms.side = 'writer';
    expect(await observeAction(rpc, pending)).toBe('unresolved');
  });
});

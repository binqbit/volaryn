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
  getAgreementEncoder,
  protocolAddresses,
  VOLARYN_PROGRAM_ADDRESS,
} from '@volaryn/protocol';
import { observeAction } from './reconcile';

const owner = address('11111111111111111111111111111111');
const other = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
async function fixture({
  status = AgreementStatus.Active as AgreementStatus,
  activated = true,
  holder = owner as Address,
  version = 1,
  program = VOLARYN_PROGRAM_ADDRESS as Address,
  history = null as unknown,
  height = 101,
  operation = 'activate' as 'activate' | 'exercise',
} = {}) {
  const accounts = await protocolAddresses(owner, owner, 1n);
  const pending = {
    signature: '1'.repeat(64),
    lastValidBlockHeight: '100',
    owner,
    agreement: accounts.agreement,
    operation,
  };
  const bytes = getAgreementEncoder().encode({
    version,
    bump: 1,
    writer: owner,
    nonce: 1n,
    designatedHolder: none(),
    holder: some(holder),
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
    { status: AgreementStatus.Funded, activated: false, expected: 'expired' },
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
    { status: AgreementStatus.Funded, expected: 'unresolved' },
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
    for (const options of [{ version: 2 }, { program: other }]) {
      const { rpc, pending } = await fixture(options);
      await expect(observeAction(rpc, pending)).rejects.toThrow(
        'Agreement identity is unsupported',
      );
    }
  });
});

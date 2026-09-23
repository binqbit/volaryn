import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address, Rpc, SolanaRpcApi } from '@solana/kit';
import {
  AccountState,
  getMintToCheckedInstructionDataDecoder,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { getTokenEncoder, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { sendAndFinalize } from '@volaryn/protocol';
import { fixtureSigners } from '../../tools/localnet/identity';
import { fixtureTokens } from '../../tools/localnet/tokens';

vi.mock('@volaryn/protocol', () => ({ sendAndFinalize: vi.fn() }));

let keys: Awaited<ReturnType<typeof fixtureSigners>>;
beforeAll(async () => {
  keys = await fixtureSigners();
});
beforeEach(() => vi.clearAllMocks());

describe.each([false, true])('fixture funding (Token-2022: %s)', (extended) => {
  const program = extended ? TOKEN_2022_PROGRAM_ADDRESS : TOKEN_PROGRAM_ADDRESS;
  const decimals = extended ? 9 : 6;
  const target = 100n * 10n ** BigInt(decimals);

  function fixture(
    amount: bigint,
    identity: { owner?: Address; mint?: Address; program?: Address } = {},
  ) {
    const data = getTokenEncoder().encode({
      mint: identity.mint ?? keys.usdc.address,
      owner: identity.owner ?? keys.holder.address,
      amount,
      delegate: null,
      state: AccountState.Initialized,
      isNative: null,
      delegatedAmount: 0n,
      closeAuthority: null,
      extensions: null,
    });
    const rpc = {
      getAccountInfo: () => ({
        send: async () => ({
          value: {
            owner: identity.program ?? program,
            data: [Buffer.from(data).toString('base64')],
          },
        }),
      }),
    } as unknown as Rpc<SolanaRpcApi>;
    const tokens = fixtureTokens(rpc, keys.authority);
    return (topUp = false) =>
      tokens.fundAccount(
        keys.holderUsdc,
        keys.holder.address,
        keys.usdc.address,
        target,
        decimals,
        extended,
        topUp,
      );
  }

  it('preserves spent balances during ordinary bootstrap', async () => {
    await fixture(0n)();
    expect(sendAndFinalize).not.toHaveBeenCalled();
  });

  it('an explicit top-up mints only the shortfall to the expected account', async () => {
    await fixture(target - 7n)(true);
    expect(sendAndFinalize).toHaveBeenCalledTimes(1);
    const instructions = vi.mocked(sendAndFinalize).mock.calls[0]![2];
    expect(instructions).toHaveLength(1);
    const instruction = instructions[0]!;
    expect(instruction.programAddress).toBe(program);
    expect(instruction.accounts?.map(({ address }) => address)).toEqual([
      keys.usdc.address,
      keys.holderUsdc.address,
      keys.authority.address,
    ]);
    expect(getMintToCheckedInstructionDataDecoder().decode(instruction.data!)).toMatchObject({
      amount: 7n,
      decimals,
    });
    vi.mocked(sendAndFinalize).mockClear();
    await fixture(target)(true);
    expect(sendAndFinalize).not.toHaveBeenCalled();
  });

  it('keeps balances above the target', async () => {
    await fixture(target + 1n)(true);
    expect(sendAndFinalize).not.toHaveBeenCalled();
  });

  it.each(['owner', 'mint', 'program'] as const)(
    'rejects a mismatched %s before minting',
    async (field) => {
      await expect(fixture(0n, { [field]: keys.writer.address })(true)).rejects.toThrow(
        'incompatible ownership',
      );
      expect(sendAndFinalize).not.toHaveBeenCalled();
    },
  );
});

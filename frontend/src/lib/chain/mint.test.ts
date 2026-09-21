import { describe, expect, it } from 'vitest';
import { address, none, some } from '@solana/kit';
import { type Mint } from '@solana-program/token-2022';
import { mintTerms, transferFee } from './mint';

const owner = address('11111111111111111111111111111111');
const mint: Mint = {
  mintAuthority: none(),
  supply: 1000000n,
  decimals: 6,
  isInitialized: true,
  freezeAuthority: some(owner),
  extensions: none(),
};

describe('issuer delivery terms', () => {
  it('uses integer ceiling, caps and exact u64 quantities for transfer fees', () => {
    expect(transferFee(1n, 75, 1000000n)).toBe(1n);
    expect(transferFee(1000000n, 75, 1000000n)).toBe(7500n);
    expect(transferFee(18446744073709551615n, 10000, 19n)).toBe(19n);
  });
  it('selects the fee schedule at the epoch boundary and reports issuer restrictions', () => {
    const config: Mint = {
      ...mint,
      extensions: some([
        {
          __kind: 'TransferFeeConfig',
          transferFeeConfigAuthority: owner,
          withdrawWithheldAuthority: owner,
          withheldAmount: 0n,
          olderTransferFee: { epoch: 0n, maximumFee: 1000000n, transferFeeBasisPoints: 75 },
          newerTransferFee: { epoch: 10n, maximumFee: 1000000n, transferFeeBasisPoints: 100 },
        },
        { __kind: 'PermanentDelegate', delegate: owner },
      ]),
    };
    expect(mintTerms(config, 1000000n, 9n).issuerFee).toBe(7500n);
    const terms = mintTerms(config, 1000000n, 10n);
    expect(terms.netReceipt).toBe(990000n);
    expect(terms.accountSize).toBeGreaterThan(165);
    expect(terms.restrictions.join(' ')).toContain('permanent delegate');
    expect(terms.restrictions.join(' ')).toContain('freeze');
  });
  it('blocks paused or unsupported delivery extensions', () => {
    expect(() =>
      mintTerms(
        {
          ...mint,
          extensions: some([{ __kind: 'PausableConfig', authority: some(owner), paused: true }]),
        },
        1n,
        1n,
      ),
    ).toThrow('paused');
    expect(() =>
      mintTerms({ ...mint, extensions: some([{ __kind: 'NonTransferable' }]) }, 1n, 1n),
    ).toThrow('unsupported');
  });
});

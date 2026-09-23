import { describe, expect, it } from 'vitest';
import { address, getBase64Encoder, none, some } from '@solana/kit';
import { AccountState, getMintDecoder, type Mint } from '@solana-program/token-2022';
import captured from '../../../../tests/fixtures/prestocks/accounts.json';
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
  it('reviews every captured official extension combination without changing gross units', () => {
    for (const account of captured.result.value) {
      const mint = getMintDecoder().decode(getBase64Encoder().encode(account.data[0]!));
      const review = mintTerms(mint, 1000000000n, 1039n);
      expect(review.decimals).toBe(9);
      expect(review.issuerFee).toBe(10000000n);
      expect(review.netReceipt).toBe(990000000n);
      expect(review.accountSize).toBeGreaterThan(165);
      expect(review.restrictions.join(' ')).toContain('transparent');
    }
  });
  it('rejects an active hook and frozen defaults while preserving existing delivery', () => {
    const frozen: Mint = {
      ...mint,
      extensions: some([{ __kind: 'DefaultAccountState', state: AccountState.Frozen }]),
    };
    expect(() => mintTerms(frozen, 1n, 1n)).toThrow('frozen');
    expect(mintTerms(frozen, 1n, 1n, false).netReceipt).toBe(1n);
    const active: Mint = {
      ...mint,
      extensions: some([
        {
          __kind: 'TransferHook',
          authority: owner,
          programId: address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
        },
      ]),
    };
    expect(() => mintTerms(active, 1n, 1n)).toThrow('Active transfer hooks');
  });
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

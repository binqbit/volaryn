import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';
import registry from '../../config/assets.json' with { type: 'json' };
import { recipe } from './identity';

// Explicit seeds keep local identities stable if the issuer registry is reordered.
const seeds = {
  OPENAI: 20,
  SPACEX: 21,
  ANTHROPIC: 22,
  ANDURIL: 23,
  FIGUREAI: 24,
  KALSHI: 25,
  NEURALINK: 26,
  POLYMARKET: 27,
};

// Interactive demos need room for repeated trades; contract tests keep their small balances.
export const demoBalances = {
  usdc: 10_000n * 10n ** BigInt(recipe.decimals),
  tokenUnits: 100n,
};

/** Disposable replicas, linked to reviewed issuer identities, never mainnet signers. */
export async function fixtureAssets() {
  return Promise.all(
    Object.entries(seeds).map(async ([symbol, seed]) => {
      const reference = registry.assets.find((asset) => asset.symbol === symbol);
      if (!reference) throw new Error(`Missing reviewed PreStocks asset: ${symbol}`);
      const mint = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(seed));
      const holderAccount = await createKeyPairSignerFromPrivateKeyBytes(
        new Uint8Array(32).fill(seed + 20),
      );
      const writerAccount = await createKeyPairSignerFromPrivateKeyBytes(
        new Uint8Array(32).fill(seed + 40),
      );
      return {
        mint,
        holderAccount,
        writerAccount,
        asset: {
          mint: mint.address,
          referenceMint: reference.mint,
          name: reference.name,
          symbol,
          decimals: reference.decimals,
          source: reference.source,
        },
      };
    }),
  );
}

/** Reuse contract fixture economics with each replica's own base-unit precision. */
export function fixtureUnits(value: string, decimals: number) {
  if (decimals < recipe.decimals) throw new Error('Fixture precision is too low');
  return BigInt(value) * 10n ** BigInt(decimals - recipe.decimals);
}

import { createKeyPairSignerFromPrivateKeyBytes } from '@solana/kit';
import recipe from '../../tests/fixtures/recipe.json' with { type: 'json' };

export { recipe };

/** Public, disposable fixture identities. Never imported by the application server. */
export async function fixtureSigners() {
  const pairs = await Promise.all(
    Object.entries(recipe.seeds).map(
      async ([name, seed]) =>
        [
          name,
          await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(32).fill(seed)),
        ] as const,
    ),
  );
  return Object.fromEntries(pairs) as Record<
    keyof typeof recipe.seeds,
    Awaited<ReturnType<typeof createKeyPairSignerFromPrivateKeyBytes>>
  >;
}

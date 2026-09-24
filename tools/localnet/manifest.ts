import { isDeepStrictEqual } from 'node:util';
import type { Deployment } from '../../frontend/src/lib/api/client';

/** Validate local identity; true means a matching schema-2 file needs republishing. */
export function checkLocalManifest(existing: unknown, expected: Deployment): boolean {
  const { schemaVersion, localnet, upgradeAuthority, ...identity } = expected;
  if (
    schemaVersion === 3 &&
    identity.mode === 'localnet' &&
    localnet &&
    upgradeAuthority === identity.authority
  ) {
    if (isDeepStrictEqual(existing, expected)) return false;
    // Only the generated layout changes. Every previously recorded identity must still match.
    if (isDeepStrictEqual(existing, { ...identity, schemaVersion: 2, ...localnet })) return true;
  }
  throw new Error(
    'Deployment identity differs from the existing fixture manifest. Check the manifest and program-change procedures in docs/development.md. Existing data was not reset.',
  );
}

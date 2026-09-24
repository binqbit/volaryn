import { isDeepStrictEqual } from 'node:util';
import type { Deployment } from '../../frontend/src/lib/api/client';

/** Accept only the current local format with the exact recorded identity. */
export function checkLocalManifest(existing: unknown, expected: Deployment): void {
  if (
    expected.schemaVersion === 3 &&
    expected.mode === 'localnet' &&
    expected.localnet &&
    expected.upgradeAuthority === expected.authority &&
    isDeepStrictEqual(existing, expected)
  )
    return;
  throw new Error(
    'Deployment format or identity differs from the existing fixture manifest. See docs/development.md#local-development-reset to start a fresh local environment. Existing data was not reset.',
  );
}

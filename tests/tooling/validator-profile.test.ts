import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

test('the validator permits io_uring while retaining the pinned default-deny policy', () => {
  const profile = JSON.parse(
    readFileSync(new URL('../../tools/localnet/seccomp/validator.json', import.meta.url), 'utf8'),
  ) as { defaultAction: string; syscalls: { names: string[]; action: string }[] };
  const required = ['io_uring_setup', 'io_uring_enter', 'io_uring_register'];
  const extensions = profile.syscalls.filter((rule) =>
    rule.names.some((name) => required.includes(name)),
  );
  expect(profile.defaultAction).toBe('SCMP_ACT_ERRNO');
  expect(extensions).toEqual([{ names: required, action: 'SCMP_ACT_ALLOW' }]);

  // Changes to other syscalls must come from an explicitly reviewed upstream update.
  const baseline = {
    ...profile,
    syscalls: profile.syscalls.filter((rule) => !extensions.includes(rule)),
  };
  expect(createHash('sha256').update(JSON.stringify(baseline)).digest('hex')).toBe(
    '4dc1298afa7676147c1320afa42d72691fc55379ae762b392b56853574a7a38a',
  );
});

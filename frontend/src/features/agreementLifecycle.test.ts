import { expect, it } from 'vitest';
import { agreementLifecycle } from './agreementLifecycle';
import type { Agreement } from '../lib/api/client';

const agreement = { status: 'open', acceptBefore: '100', expiresAt: '200' } as Agreement;
it('uses exact deadline boundaries and distinguishes reclaimable from reclaimed reserves', () => {
  expect(agreementLifecycle(agreement, 99n)).toEqual({ label: 'Available', open: true });
  expect(agreementLifecycle(agreement, 100n)).toEqual({ label: 'Acceptance ended', open: false });
  expect(agreementLifecycle({ ...agreement, status: 'active' }, 200n).label).toBe(
    'Expired · awaiting reclaim',
  );
  expect(agreementLifecycle({ ...agreement, status: 'expired' }, 200n).label).toBe(
    'Expired · reserve reclaimed',
  );
  expect(agreementLifecycle(agreement, undefined).open).toBe(false);
});

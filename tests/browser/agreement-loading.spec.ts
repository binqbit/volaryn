import { connectWallet } from './support/actions';
import { expect, test } from '@playwright/test';
import { balanceFixture } from './support/balanceFixture';
import { journalKey } from '../../frontend/src/features/journal';
import type { PendingTransaction } from '../../frontend/src/features/pending';

test('a newly signed offer waits for finalized data without a false outage and appears automatically', async ({
  page,
}) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  state.wallets[d.localnet!.writer]!.accounts = [
    account(d.usdcMint, d.localnet!.writerUsdc, '100000000'),
  ];
  const pending: PendingTransaction = {
    signature: '1'.repeat(64),
    lastValidBlockHeight: '1000',
    owner: d.localnet!.writer,
    side: 'writer',
    actorRole: 'writer',
    operation: 'create',
    agreement: state.agreement.address,
    createdTerms: {
      side: 'writer',
      underlyingMint: state.agreement.underlyingMint,
      nonce: '91',
      quantityRaw: state.agreement.quantityRaw,
      payout: state.agreement.payout,
      premium: state.agreement.premium,
      acceptBefore: state.agreement.acceptBefore,
      expiresAt: state.agreement.expiresAt,
      designatedCounterparty: null,
    },
  };
  const key = journalKey(d.genesisHash, d.programId, d.localnet!.writer);
  await page.addInitScript(
    ({ key, pending }) => {
      localStorage.setItem(key, JSON.stringify(pending));
    },
    { key, pending },
  );
  let finalized = false;
  await page.route('**/rpc', async (route) => {
    const { method, id } = route.request().postDataJSON();
    if (method === 'getSignatureStatuses')
      return route.fulfill({
        json: {
          jsonrpc: '2.0',
          id,
          result: {
            context: { slot: 42 },
            value: [
              finalized
                ? { slot: 42, err: null, confirmationStatus: 'finalized', confirmations: null }
                : null,
            ],
          },
        },
      });
    if (method === 'getBlockHeight')
      return route.fulfill({ json: { jsonrpc: '2.0', id, result: 42 } });
    await route.fallback();
  });
  await page.route('**/api/agreements/*', (route) =>
    route.fulfill(
      finalized
        ? { json: state.agreement }
        : { status: 404, json: { code: 'not_found', message: 'Not found' } },
    ),
  );
  await page.goto(`/agreements/${state.agreement.address}`);
  await connectWallet(page, 'Test Wallet 2');
  await expect(page.getByRole('heading', { name: 'No finalized agreement yet' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel offer', exact: true })).toHaveCount(0);
  const status = page.getByRole('status', { name: 'Transaction status' });
  await expect(status).toContainText('confirmation pending');
  const statusBox = await status.boundingBox();
  const headingBox = await page.getByRole('heading', { name: 'Agreement details' }).boundingBox();
  expect(statusBox!.y + statusBox!.height).toBeLessThanOrEqual(headingBox!.y);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).not.toBeNull();

  finalized = true;
  await expect(
    page.getByRole('article', { name: `Agreement ${state.agreement.address}`, exact: true }),
  ).toBeVisible();
  await expect(status).toContainText('Transaction finalized');
  await expect(page.getByRole('heading', { name: 'No finalized agreement yet' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel offer', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  expect(state.unexpected).toEqual([]);
});

test('an unavailable API remains an error, keeps known terms, and disables actions until recovery', async ({
  page,
}) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  state.wallets[d.localnet!.holder]!.accounts = [
    account(d.usdcMint, d.localnet!.holderUsdc, '1500000'),
  ];
  let unavailable = false;
  await page.route('**/api/agreements/*', (route) =>
    route.fulfill(
      unavailable
        ? { status: 503, json: { code: 'chain_unavailable', message: 'Unavailable' } }
        : { json: state.agreement },
    ),
  );
  await page.goto(`/agreements/${state.agreement.address}`);
  await connectWallet(page, 'Test Wallet 1');
  const activate = page.getByRole('button', { name: 'Activate protection' });
  await expect(activate).toBeEnabled();
  unavailable = true;
  await expect(page.getByRole('alert')).toContainText('Agreement data is unavailable.');
  await expect(
    page.getByRole('article', { name: `Agreement ${state.agreement.address}`, exact: true }),
  ).toBeVisible();
  await expect(activate).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'No finalized agreement yet' })).toHaveCount(0);
  unavailable = false;
  await page.getByRole('button', { name: 'Refresh agreement' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(activate).toBeEnabled();
  expect(state.unexpected).toEqual([]);
});

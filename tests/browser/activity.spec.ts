import { expect, test } from '@playwright/test';
import { balanceFixture } from './support/balanceFixture';
import { journalKey } from '../../frontend/src/features/journal';
import { activityKey } from '../../frontend/src/features/activity/storage';

test('pending offers restore from the server, survive reload, and become completed history', async ({
  page,
}, info) => {
  const { state } = await balanceFixture(page);
  const d = state.deployment;
  const signature = '1'.repeat(64);
  let finalized = false;
  const receipt = () => ({
    id: '1',
    signature,
    owner: d.writer,
    agreement: state.agreement.address,
    operation: 'create',
    createdTerms: {
      underlyingMint: state.agreement.underlyingMint,
      nonce: '91',
      quantityRaw: state.agreement.quantityRaw,
      payout: state.agreement.payout,
      premium: state.agreement.premium,
      acceptBefore: state.agreement.acceptBefore,
      expiresAt: state.agreement.expiresAt,
      designatedHolder: null,
    },
    lastValidBlockHeight: '1000',
    status: finalized ? 'finalized' : 'pending',
    createdAt: 1800000000,
    updatedAt: 1800000000,
  });
  await page.route('**/api/activity?*', (route) => {
    const mine = new URL(route.request().url()).searchParams.get('owner') === d.writer;
    return route.fulfill({
      json: {
        items: mine ? [receipt()] : [],
        pending: mine && !finalized ? [receipt()] : [],
        next: null,
      },
    });
  });
  await page.route('**/api/agreements?*', (route) =>
    route.fulfill({ json: finalized ? [state.agreement] : [] }),
  );
  await page.route('**/rpc', async (route) => {
    const { id, method } = route.request().postDataJSON();
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
  await page.goto('/portfolio/written');
  await page.getByRole('button', { name: 'Connect Test Wallet 2', exact: true }).click();
  const progress = page.getByRole('region', { name: 'Operations in progress' });
  await expect(progress).toContainText('Create funded offer');
  await expect(progress).toContainText('Awaiting confirmation');
  await expect(page.getByRole('heading', { name: 'No offers created yet' })).toHaveCount(0);
  const key = journalKey(d.genesisHash, d.programId, d.writer);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).not.toBeNull();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Your wallet' })).toContainText(d.writer);
  await expect(progress).toBeVisible();
  finalized = true;
  await expect(
    page.getByRole('article', { name: `Agreement ${state.agreement.address}` }),
  ).toBeVisible();
  await expect(progress).toHaveCount(0);
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  const history = page.getByRole('region', { name: 'Operation history' });
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await expect(history).toContainText('Finalized');
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  await page.reload();
  await expect(history).toContainText('Finalized');
  await page.screenshot({ path: info.outputPath('activity-finalized.png'), fullPage: true });
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(history).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect Test Wallet 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No operations yet' })).toBeVisible();
  expect(state.unexpected).toEqual([]);
});

test('interrupted signing remains visible without inventing a transaction or reconnecting after disconnect', async ({
  page,
}) => {
  const { state } = await balanceFixture(page);
  const d = state.deployment;
  const key = activityKey(journalKey(d.genesisHash, d.programId, d.holder));
  await page.addInitScript(
    ({ key, owner, agreement }) => {
      localStorage.setItem(
        key,
        JSON.stringify([
          {
            id: 'abandoned',
            owner,
            agreement,
            operation: 'activate',
            status: 'awaiting-signature',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            source: 'browser',
          },
        ]),
      );
    },
    { key, owner: d.holder, agreement: state.agreement.address },
  );
  await page.goto('/portfolio/activity');
  await page.getByRole('button', { name: 'Connect Test Wallet 1', exact: true }).click();
  const history = page.getByRole('region', { name: 'Operation history' });
  await expect(history).toContainText('Signing interrupted · not submitted');
  await expect(history).toContainText('Unsigned attempt · saved in this browser');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Connect Test Wallet 1', exact: true }),
  ).toBeVisible();
  await expect(history).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});

test('wallet preference from another ledger is never restored', async ({ page }) => {
  const { state } = await balanceFixture(page);
  await page.addInitScript((d) => {
    localStorage.setItem(`volaryn:wallet:other-ledger:${d.programId}`, `Test Wallet 1:${d.holder}`);
  }, state.deployment);
  await page.goto('/portfolio');
  await expect(
    page.getByRole('button', { name: 'Connect Test Wallet 1', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});

test('an activity outage preserves ongoing confirmation and the saved signature', async ({
  page,
}) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  state.wallets[d.holder]!.accounts = [account(d.usdcMint, d.holderUsdc, '100000000')];
  const receipt = {
    id: '1',
    signature: '1'.repeat(64),
    owner: d.holder,
    agreement: state.agreement.address,
    operation: 'activate',
    createdTerms: null,
    lastValidBlockHeight: '1000',
    status: 'pending',
    createdAt: 1800000000,
    updatedAt: 1800000000,
  };
  let unavailable = false;
  await page.route('**/api/activity?*', (route) =>
    route.fulfill(
      unavailable
        ? { status: 503, json: { code: 'database_unavailable' } }
        : { json: { items: [receipt], pending: [receipt], next: null } },
    ),
  );
  await page.route('**/rpc', async (route) => {
    const { id, method } = route.request().postDataJSON();
    if (method === 'getSignatureStatuses')
      return route.fulfill({
        json: { jsonrpc: '2.0', id, result: { context: { slot: 42 }, value: [null] } },
      });
    if (method === 'getBlockHeight')
      return route.fulfill({ json: { jsonrpc: '2.0', id, result: 42 } });
    await route.fallback();
  });
  await page.goto(`/agreements/${state.agreement.address}`);
  await page.getByRole('button', { name: 'Connect Test Wallet 1', exact: true }).click();
  const status = page.getByRole('status', { name: 'Transaction status' });
  await expect(status).toContainText('confirmation pending');
  unavailable = true;
  await expect(page.getByRole('alert')).toContainText('Activity is unavailable');
  await expect(status).toContainText(receipt.signature);
  await expect(page.getByRole('button', { name: /^Activate protection/ })).toBeDisabled();
  const key = journalKey(d.genesisHash, d.programId, d.holder);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toContain(receipt.signature);
  unavailable = false;
  await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(status).toContainText('confirmation pending');
  expect(state.unexpected).toEqual([]);
});

import { expect, test } from '@playwright/test';
import { balanceFixture } from './support/balanceFixture';
import { connectWallet, selectAsset, switchWallet } from './support/actions';

test('a failed offer review brings its error into view without requesting a signature', async ({
  page,
}) => {
  const { state, account } = await balanceFixture(page);
  const deployment = state.deployment;
  state.wallets[deployment.localnet!.writer]!.accounts = [
    account(deployment.usdcMint, deployment.localnet!.writerUsdc, '100000000'),
  ];
  let genesisReads = 0;
  await page.route('**/rpc', async (route) => {
    const request = route.request().postDataJSON() as { id: number; method: string };
    if (request.method !== 'getGenesisHash') return route.fallback();
    await route.fulfill({
      json: {
        jsonrpc: '2.0',
        id: request.id,
        result: genesisReads++ === 0 ? deployment.genesisHash : deployment.usdcMint,
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/offers/new');
  await connectWallet(page, 'Test Wallet 2');
  await selectAsset(page, 'OPENAI');
  await page.getByRole('button', { name: 'Review funded offer' }).click();
  const error = page.getByRole('alert');
  await expect(error).toContainText('Wrong network: the ledger identity changed');
  await expect(error).toBeInViewport({ timeout: 2000 });
  await expect(error).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review funded offer' })).toBeEnabled();
  expect(state.unexpected).toEqual([]);
});

test('a failed offer review confirmation focuses its error without signing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/offers/new');
  await switchWallet(page, 'writer');
  await selectAsset(page, 'SPACEX');
  await page.getByRole('button', { name: 'Review funded offer' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.route('**/rpc', async (route) => {
    const request = route.request().postDataJSON() as { id: number; method: string };
    if (request.method !== 'getGenesisHash') return route.continue();
    await route.fulfill({
      json: { jsonrpc: '2.0', id: request.id, result: '11111111111111111111111111111111' },
    });
  });
  let submissions = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/rpc') && request.postDataJSON()?.method === 'sendTransaction')
      submissions++;
  });
  await page.getByRole('button', { name: 'Confirm and sign', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const error = page.getByRole('alert');
  await expect(error).toContainText('Wrong network: the ledger identity changed');
  await expect(error).toBeInViewport();
  await expect(error).toBeFocused();
  expect(submissions).toBe(0);
});

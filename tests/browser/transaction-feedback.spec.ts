import { expect, test } from '@playwright/test';
import { balanceFixture } from './support/balanceFixture';
import { connectWallet, selectAsset, switchWallet } from './support/actions';
import { injectWallet } from './support/injectedWallet';

test('a failed offer review brings its error into view without requesting a signature', async ({
  page,
}) => {
  const { state, account } = await balanceFixture(page);
  const deployment = state.deployment;
  state.wallets[deployment.localnet!.writer]!.accounts = [
    account(deployment.usdcMint, deployment.localnet!.writerUsdc, '100000000'),
  ];
  await injectWallet(page, {
    address: deployment.localnet!.writer,
    name: 'Review test wallet',
  });
  let wrongNetwork = false;
  let submissions = 0;
  await page.route('**/rpc', async (route) => {
    const request = route.request().postDataJSON() as { id: number; method: string };
    if (request.method === 'sendTransaction') submissions++;
    if (request.method !== 'getGenesisHash' || !wrongNetwork) return route.fallback();
    await route.fulfill({
      json: {
        jsonrpc: '2.0',
        id: request.id,
        result: deployment.usdcMint,
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/offers/new');
  await connectWallet(page, 'Review test wallet');
  await page.getByRole('button', { name: 'Provide protection', exact: true }).click();
  await selectAsset(page, 'OPENAI');
  const form = page.getByRole('form', { name: 'Create an offer' });
  await expect(form.getByLabel('Acceptance deadline (UTC)')).not.toHaveValue('');
  await expect(form.getByLabel('Protection expiry (UTC)')).not.toHaveValue('');
  const review = form.getByRole('button', { name: 'Review funded offer' });
  await expect(review).toBeEnabled();
  expect(await form.evaluate((element) => (element as HTMLFormElement).checkValidity())).toBe(true);
  // Keep startup and initial date suggestions valid before testing review preparation failure.
  wrongNetwork = true;
  await review.click();
  const error = page.getByRole('alert');
  await expect(error).toContainText('Wrong network: the ledger identity changed');
  await expect(error).toBeInViewport({ timeout: 2000 });
  await expect(error).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(review).toBeEnabled();
  expect(await page.evaluate(() => window.__volarynWalletFixture.stats.signatures)).toBe(0);
  expect(submissions).toBe(0);
  expect(state.unexpected).toEqual([]);
});

test('a failed offer review confirmation focuses its error without signing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/offers/new');
  await switchWallet(page, 'writer');
  await page.getByRole('button', { name: 'Provide protection', exact: true }).click();
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

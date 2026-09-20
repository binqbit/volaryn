import { expect, test } from '@playwright/test';
import type { Agreement, Deployment } from '../../frontend/src/lib/api/client';

test('holdings load only after connection and disappear on disconnect or reload', async ({
  page,
  request,
}, info) => {
  const config = (await (await request.get('/api/config')).json()) as Deployment;
  const owners: string[] = [];
  let submissions = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/positions') owners.push(url.searchParams.get('owner') ?? '');
    if (url.pathname === '/rpc' && request.postDataJSON()?.method === 'sendTransaction')
      submissions++;
  });
  await page.goto('/');
  const wallet = page.getByRole('region', { name: 'Your wallet' });
  const connect = wallet.getByRole('button', { name: 'Connect Local test wallet' });
  await expect(connect).toBeVisible();
  await expect(wallet).toContainText('No wallet holdings are loaded before you connect.');
  await expect(wallet.getByText('Available test USDC', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Public agreements' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Agreement .* ↗/ })).toBeVisible();
  expect(owners).toEqual([]);
  await page.screenshot({ path: info.outputPath('disconnected.png'), fullPage: true });

  await connect.click();
  await expect(wallet).toContainText(config.holder);
  await expect(wallet).toContainText('starting balances were preloaded for the local demo');
  await expect(wallet.getByText('Available test USDC', { exact: true })).toBeVisible();
  expect(owners.length).toBeGreaterThan(0);
  expect(owners.every((owner) => owner === config.holder)).toBe(true);
  await page.screenshot({ path: info.outputPath('connected.png'), fullPage: true });

  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(connect).toBeVisible();
  await expect(wallet.getByText(config.holder, { exact: true })).toHaveCount(0);
  await expect(wallet.getByText('Available test USDC', { exact: true })).toHaveCount(0);
  const countAfterDisconnect = owners.length;
  // An agreement refresh must not fetch disconnected wallet holdings.
  await page.getByRole('link', { name: /Agreement .* ↗/ }).click();
  await expect(page.getByRole('heading', { name: 'Agreement details' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Agreement .* ↗/ })).toBeVisible();
  expect(owners).toHaveLength(countAfterDisconnect);

  await connect.click();
  await expect(wallet.getByText('Available test USDC', { exact: true })).toBeVisible();
  const countBeforeReload = owners.length;
  await page.reload();
  await expect(connect).toBeVisible();
  await expect(wallet.getByText('Available test USDC', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Agreement .* ↗/ })).toBeVisible();
  expect(owners).toHaveLength(countBeforeReload);
  expect(submissions).toBe(0);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('mobile-disconnected.png'), fullPage: true });
});

test('public agreement ownership and reserved offers never imply personal protection', async ({
  page,
  request,
}) => {
  const config = (await (await request.get('/api/config')).json()) as Deployment;
  const [original] = (await (await request.get('/api/agreements')).json()) as Agreement[];
  if (!original) throw new Error('The localnet fixture must contain an agreement');
  let agreement: Agreement = { ...original, status: 'active', holder: config.writer };
  // Presentation fixtures only; this scenario never signs or submits a transaction.
  await page.route('**/api/agreements**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname === '/api/agreements' ? [agreement] : agreement,
    }),
  );
  await page.goto('/');
  await expect(page.getByText('ACTIVE AGREEMENT', { exact: true })).toBeVisible();
  await expect(page.getByText('YOUR ACTIVE PROTECTION', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Exercise protection' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Connect Local test wallet' }).click();
  await expect(
    page.getByText('This agreement belongs to another wallet.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exercise protection' })).toHaveCount(0);

  agreement = { ...agreement, holder: config.holder };
  await page.getByRole('link', { name: /Agreement .* ↗/ }).click();
  await expect(page.getByText('YOUR ACTIVE PROTECTION', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exercise protection' })).toBeEnabled();

  agreement = { ...agreement, status: 'funded', holder: null, designatedHolder: config.writer };
  await page.getByRole('link', { name: '← All public agreements' }).click();
  await expect(
    page.getByText('This offer is reserved for another wallet.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate protection' })).toBeDisabled();
});

test('wallet loading, empty and unavailable states do not invent holdings', async ({ page }) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let unavailable = false;
  await page.route('**/api/positions?**', async (route) => {
    await pending;
    await route.fulfill(
      unavailable ? { status: 503, json: { error: 'unavailable' } } : { json: [] },
    );
  });
  await page.goto('/');
  const wallet = page.getByRole('region', { name: 'Your wallet' });
  await wallet.getByRole('button', { name: 'Connect Local test wallet' }).click();
  await expect(wallet).toContainText("Loading this wallet's balances…");
  await expect(wallet.getByText('Available test USDC', { exact: true })).toHaveCount(0);
  release();
  await expect(wallet).toContainText('No supported token accounts were found');

  unavailable = true;
  await page.getByRole('link', { name: /Agreement .* ↗/ }).click();
  await expect(wallet).toContainText('Wallet data is unavailable.');
  await expect(wallet).not.toContainText('No supported token accounts were found');
  await expect(wallet.getByText('Available test USDC', { exact: true })).toHaveCount(0);
});

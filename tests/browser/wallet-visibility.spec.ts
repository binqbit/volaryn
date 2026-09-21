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
    if (url.pathname === '/api/wallet') owners.push(url.searchParams.get('owner') ?? '');
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
  await expect(page.getByText('YOUR PROTECTION', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Exercise protection' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Connect Local test wallet' }).click();
  await expect(
    page.getByText('Only the holder can exercise this agreement.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exercise protection' })).toHaveCount(0);

  agreement = { ...agreement, holder: config.holder };
  await page.getByRole('link', { name: /Agreement .* ↗/ }).click();
  await expect(page.getByText('YOUR PROTECTION', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exercise protection' })).toBeEnabled();

  agreement = { ...agreement, status: 'funded', holder: null, designatedHolder: config.writer };
  await page.getByRole('link', { name: '← All public agreements' }).click();
  await expect(
    page.getByText('This offer is reserved for another wallet.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate protection' })).toHaveCount(0);
});

test('wallet loading, empty and unavailable states do not invent holdings', async ({ page }) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let unavailable = false;
  await page.route('**/api/wallet?**', async (route) => {
    await pending;
    await route.fulfill(
      unavailable
        ? { status: 503, json: { error: 'unavailable' } }
        : {
            json: { owner: new URL(route.request().url()).searchParams.get('owner'), accounts: [] },
          },
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
  await expect(page.getByRole('alert')).toContainText('Chain data is unavailable.');
  await expect(wallet).toContainText('Unavailable · last known');
});

test('split and frozen accounts never authorize delivery from a combined balance', async ({
  page,
  request,
}) => {
  const config = (await (await request.get('/api/config')).json()) as Deployment;
  const [original] = (await (await request.get('/api/agreements')).json()) as Agreement[];
  if (!original) throw new Error('Missing agreement');
  const agreement = {
    ...original,
    status: 'active',
    holder: config.holder,
    quantityRaw: '1000000',
    expiresAt: '4102444800',
  };
  await page.route('**/api/agreements**', (route) => route.fulfill({ json: [agreement] }));
  await page.route('**/api/wallet?**', (route) =>
    route.fulfill({
      json: {
        owner: config.holder,
        accounts: [
          {
            address: config.holderUsdc,
            mint: config.usdcMint,
            tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            amountRaw: '1000000',
            frozen: false,
            decimals: 6,
            finalizedSlot: '100',
          },
          {
            address: config.holderUnderlying,
            mint: config.underlyingMint,
            tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
            amountRaw: '600000',
            frozen: false,
            decimals: 6,
            finalizedSlot: '100',
          },
          {
            address: config.writer,
            mint: config.underlyingMint,
            tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
            amountRaw: '600000',
            frozen: false,
            decimals: 6,
            finalizedSlot: '100',
          },
          {
            address: config.authority,
            mint: config.underlyingMint,
            tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
            amountRaw: '2000000',
            frozen: true,
            decimals: 6,
            finalizedSlot: '100',
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect Local test wallet' }).click();
  await expect(page.getByRole('region', { name: 'Your wallet' })).toContainText('3.2');
  await expect(page.getByRole('button', { name: 'Exercise protection' })).toBeDisabled();
  await expect(
    page.getByLabel('Delivery token account').getByRole('option', { name: /frozen/ }),
  ).toHaveJSProperty('disabled', true);
  await expect(
    page.getByText('The selected account must contain the full gross delivery quantity.', {
      exact: false,
    }),
  ).toBeVisible();
});

test('returning to protection shows the same criteria used by the offer query', async ({
  page,
}) => {
  await page.goto('/protection');
  await page.getByLabel('Exact quantity (raw-token units)').fill('0.2');
  await page.getByLabel('Minimum payout (USDC)').fill('5');
  await page.getByLabel('Maximum premium (USDC)').fill('0.1');
  const query = page.waitForRequest(
    (request) =>
      request.url().includes('/api/offers?') &&
      new URL(request.url()).searchParams.get('quantity_raw') === '200000',
  );
  await page.getByRole('button', { name: 'Find matching offers' }).click();
  const url = new URL((await query).url());
  expect(url.searchParams.get('min_payout')).toBe('5000000');
  expect(url.searchParams.get('max_premium')).toBe('100000');
  await page.getByRole('link', { name: 'Writer', exact: true }).click();
  await page.getByRole('link', { name: 'Protection', exact: true }).click();
  await expect(page.getByLabel('Exact quantity (raw-token units)')).toHaveValue('0.2');
  await expect(page.getByLabel('Minimum payout (USDC)')).toHaveValue('5');
  await expect(page.getByLabel('Maximum premium (USDC)')).toHaveValue('0.1');
});

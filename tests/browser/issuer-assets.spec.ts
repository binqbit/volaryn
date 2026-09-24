import { expect, test } from '@playwright/test';
import registry from '../../config/assets.json' with { type: 'json' };
import { officialCatalog } from './support/officialCatalog';
import { balanceFixture } from './support/balanceFixture';
import { documentBox, paint } from './support/layout';

test('official context is read only, lazy, and separate from local holdings and payouts', async ({
  page,
}, info) => {
  const { state } = await balanceFixture(page);
  const policy = registry.assets.find((asset) => asset.symbol === 'SPACEX')!;
  const snapshot = officialCatalog();
  let reads = 0;
  let unavailable = false;
  let signatures = 0;
  let release: () => void = () => {};
  let waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/assets/official', async (route) => {
    reads++;
    await waiting;
    if (unavailable) {
      await route.fulfill({ status: 503 });
      return;
    }
    await route.fulfill({ json: snapshot });
  });
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === '/rpc' &&
      request.postDataJSON()?.method === 'sendTransaction'
    )
      signatures++;
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Set a price floor/ })).toBeVisible();
  expect(reads).toBe(0);
  await page.getByRole('link', { name: 'Official assets', exact: true }).click();
  await expect(page.getByText('Loading official sources…')).toBeVisible();
  release();
  const catalog = page.getByRole('region', { name: 'Official assets' });
  const spaceX = catalog.getByRole('article', { name: 'SPACEX official asset', exact: true });
  await expect(catalog.getByRole('heading', { name: 'SpaceX PreStocks' })).toBeVisible();
  await expect(catalog).toContainText('SOLANA MAINNET · READ ONLY');
  const notes = catalog.getByRole('complementary', { name: 'Trading and transfer notes' });
  await notes.getByRole('button', { name: 'Transfer rules & token units', exact: true }).click();
  const transferRules = page.getByRole('dialog', {
    name: 'Transfer rules & token units',
    exact: true,
  });
  const sharedRule = 'Only transparent balances can be delivered';
  await expect(transferRules.getByText(`${sharedRule}.`, { exact: true })).toBeVisible();
  await transferRules.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(catalog.getByText(`${sharedRule}.`, { exact: true })).toHaveCount(1);
  await expect(catalog.getByText(snapshot.assets[0]!.reason, { exact: true })).toHaveCount(0);
  await spaceX.getByRole('button', { name: 'Verified token behavior', exact: true }).click();
  const behavior = page.getByRole('dialog', {
    name: 'SpaceX PreStocks Verified token behavior',
    exact: true,
  });
  await expect(behavior).toContainText('The issuer can freeze token accounts and block delivery');
  await expect(
    behavior
      .locator('dt')
      .filter({ hasText: /^Current issuer fee$/ })
      .locator('..'),
  ).toContainText('100');
  await expect(
    behavior
      .locator('dt')
      .filter({ hasText: /^Current issuer fee$/ })
      .locator('..'),
  ).toContainText('basis points');
  await expect(
    behavior
      .locator('dt')
      .filter({ hasText: /^Maximum fee$/ })
      .locator('..'),
  ).toContainText('1000000');
  await expect(
    behavior
      .locator('dt')
      .filter({ hasText: /^Maximum fee$/ })
      .locator('..'),
  ).toContainText('raw units');
  await expect(behavior).not.toContainText(sharedRule);
  await behavior.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(spaceX.getByText('120.687', { exact: true })).toBeVisible();
  await expect(spaceX.getByRole('term').filter({ hasText: /^Issuer conversion$/ })).toBeVisible();
  await expect(
    spaceX.getByRole('term').filter({ hasText: /^Latest protection expiry$/ }),
  ).toBeVisible();
  await expect(spaceX.locator('time').last()).toHaveAttribute(
    'datetime',
    new Date(policy.maxExpiry * 1000).toISOString(),
  );
  await expect(
    spaceX
      .locator('dt')
      .filter({ hasText: /^Mark price · source value$/ })
      .locator('..'),
  ).toContainText('Unavailable');
  const search = catalog.getByLabel('Search official PreStocks');
  await search.fill('unknown-token');
  await expect(catalog.getByText('No official PreStocks match this search.')).toBeVisible();
  await expect(catalog.getByRole('article')).toHaveCount(0);
  await search.fill(policy.mint);
  await expect(catalog.getByRole('article')).toHaveCount(1);
  await search.fill('space');
  await expect(catalog.getByRole('heading', { name: 'SpaceX PreStocks' })).toBeVisible();
  await expect(notes).toContainText(sharedRule);
  await expect(spaceX).not.toContainText(sharedRule);
  await search.clear();
  await expect(
    catalog.getByRole('button', { name: 'Refresh issuer context', exact: true }),
  ).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Your wallet' })).toHaveCount(0);
  await expect(catalog.getByRole('article')).toHaveCount(registry.assets.length);
  const polymarket = catalog.getByRole('article', {
    name: 'POLYMARKET official asset',
    exact: true,
  });
  const spaceBox = await documentBox(spaceX);
  const polyBox = await documentBox(polymarket);
  expect(spaceBox.y).toBe(polyBox.y);
  expect(spaceBox.height).toBe(polyBox.height);
  expect((await documentBox(spaceX.getByRole('button', { name: /^Asset details/ }))).y).toBe(
    (await documentBox(polymarket.getByRole('button', { name: /^Asset details/ }))).y,
  );
  expect((await documentBox(spaceX.getByRole('link', { name: 'View on PreStocks' }))).y).toBe(
    (await documentBox(polymarket.getByRole('link', { name: 'View on PreStocks' }))).y,
  );
  await page.screenshot({ path: info.outputPath('official-assets-compact.png'), fullPage: true });
  await spaceX.getByRole('button', { name: /^Asset details/ }).click();
  const assetDetails = page.getByRole('dialog', {
    name: 'SpaceX PreStocks Asset details',
    exact: true,
  });
  await expect(assetDetails.getByText(policy.mint, { exact: true })).toBeVisible();
  await expect(assetDetails.getByText('120.6869953806347', { exact: true })).toBeVisible();
  await expect(assetDetails).toContainText('at least 1 day earlier');
  await page.screenshot({ path: info.outputPath('official-assets-desktop.png') });
  await assetDetails.getByRole('button', { name: 'Close', exact: true }).click();
  const box = await documentBox(spaceX);
  waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const refreshRequest = page.waitForRequest('**/api/assets/official');
  await catalog.getByRole('button', { name: 'Refresh issuer context' }).click();
  await refreshRequest;
  await spaceX.getByRole('button', { name: /^Asset details/ }).click();
  await paint(page);
  expect(
    await documentBox(
      page.getByRole('article', {
        name: 'SPACEX official asset',
        exact: true,
        includeHidden: true,
      }),
    ),
  ).toEqual(box);
  await expect(page.getByText('Loading official sources…')).toHaveCount(0);
  await expect(assetDetails.getByText(policy.mint, { exact: true })).toBeVisible();
  const refreshed = page.waitForResponse('**/api/assets/official');
  release();
  await refreshed;
  await expect(assetDetails).toBeVisible();
  await assetDetails.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(catalog.getByRole('button', { name: 'Refresh issuer context' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  snapshot.marketSource = { ...snapshot.marketSource, status: 'stale', error: 'rate_limited' };
  snapshot.assets[0]!.eligibility = 'stale';
  snapshot.assets[0]!.reason = 'Fresh issuer observations are required for new admission';
  snapshot.assets[0]!.chain = null;
  await catalog.getByRole('button', { name: 'Refresh issuer context' }).click();
  await expect(catalog).toContainText('A source is unavailable');
  await expect(catalog.getByText(snapshot.assets[0]!.reason, { exact: true })).toBeVisible();
  // Incomplete evidence cannot establish a rule shared by the whole catalog.
  await expect(notes).not.toContainText(sharedRule);
  await expect(spaceX).toContainText(sharedRule);
  await expect(catalog).toContainText('120.6869953806347');
  unavailable = true;
  await catalog.getByRole('button', { name: 'Refresh issuer context' }).click();
  await expect(catalog.getByRole('alert')).toContainText('last known observations');
  await expect(catalog).toContainText('120.6869953806347');
  await page.setViewportSize({ width: 375, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('official-assets-mobile.png'), fullPage: true });
  await spaceX.getByRole('button', { name: /^Asset details/ }).click();
  await assetDetails.screenshot({ path: info.outputPath('official-asset-card-mobile.png') });
  await assetDetails.getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Explore offers', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Explore offers' })).toBeVisible();
  await expect(
    page.getByRole('banner').getByRole('button', { name: 'Connect wallet', exact: true }),
  ).toBeVisible();
  expect(signatures).toBe(0);
  expect(state.unexpected).toEqual([]);
});

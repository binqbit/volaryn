import { expect, test } from '@playwright/test';
import registry from '../../config/assets.json' with { type: 'json' };
import type { components } from '../../frontend/src/lib/api/schema';
import { balanceFixture } from './support/balanceFixture';
import { documentBox, paint } from './support/layout';

test('official context is read only, lazy, and separate from local holdings and payouts', async ({
  page,
}, info) => {
  const { state } = await balanceFixture(page);
  const policy = registry.assets.find((asset) => asset.symbol === 'SPACEX')!;
  const snapshot: components['schemas']['OfficialCatalog'] = {
    network: 'solana:mainnet',
    genesisHash: registry.genesisHash,
    source: 'https://prestocks.com/api/prestocks',
    marketSource: { status: 'fresh', receivedAt: policy.reviewedAt, error: null },
    chainSource: { status: 'fresh', receivedAt: policy.reviewedAt, error: null },
    finalizedSlot: '448898437',
    assets: registry.assets.map((policy) => ({
      mint: policy.mint,
      name: policy.name,
      symbol: policy.symbol,
      policy,
      eligibility: 'compatible',
      reason: 'Reviewed transparent transfers. Trading requires a released deployment.',
      market: {
        tokenPrice: '120.6869953806347',
        markPrice: null,
        impliedValuation: null,
        markValuation: null,
        supply: '43712.533765345',
        observedAt: null,
        unitsVerified: false,
      },
      chain: null,
    })),
  };
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
  await expect(catalog).toContainText('120.6869953806347');
  await expect(catalog).toContainText('Issuer conversion deadline:');
  await expect(spaceX.locator('dt').filter({ hasText: 'Mark price' }).locator('..')).toContainText(
    'Unavailable',
  );
  const search = catalog.getByLabel('Search official PreStocks');
  await search.fill('unknown-token');
  await expect(catalog.getByText('No official PreStocks match this search.')).toBeVisible();
  await expect(catalog.getByRole('article')).toHaveCount(0);
  await search.fill(policy.mint);
  await expect(catalog.getByRole('article')).toHaveCount(1);
  await search.fill('space');
  await expect(catalog.getByRole('heading', { name: 'SpaceX PreStocks' })).toBeVisible();
  await search.clear();
  await expect(catalog.getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Your wallet' })).toHaveCount(0);
  await expect(catalog.getByRole('article')).toHaveCount(registry.assets.length);
  await spaceX.getByText('Asset details', { exact: false }).click();
  await expect(spaceX.getByText(policy.mint, { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('official-assets-desktop.png'), fullPage: true });
  const box = await documentBox(spaceX);
  waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const refreshRequest = page.waitForRequest('**/api/assets/official');
  await catalog.getByRole('button', { name: 'Refresh issuer context' }).click();
  await refreshRequest;
  await paint(page);
  expect(await documentBox(spaceX)).toEqual(box);
  await expect(page.getByText('Loading official sources…')).toHaveCount(0);
  await expect(spaceX.getByText(policy.mint, { exact: true })).toBeVisible();
  release();
  await expect(catalog.getByRole('button')).toHaveAttribute('aria-busy', 'false');
  snapshot.marketSource = { ...snapshot.marketSource, status: 'stale', error: 'rate_limited' };
  snapshot.assets[0]!.eligibility = 'stale';
  snapshot.assets[0]!.reason = 'Fresh issuer observations are required for new admission';
  await catalog.getByRole('button', { name: 'Refresh issuer context' }).click();
  await expect(catalog).toContainText('A source is unavailable');
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
  await spaceX.screenshot({ path: info.outputPath('official-asset-card-mobile.png') });
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Explore offers', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Explore offers' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Connect Test Wallet 1', exact: true }),
  ).toBeVisible();
  expect(signatures).toBe(0);
  expect(state.unexpected).toEqual([]);
});

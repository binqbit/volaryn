import { expect, test } from '@playwright/test';
import registry from '../../config/assets.json' with { type: 'json' };
import type { components } from '../../frontend/src/lib/api/schema';
import { balanceFixture } from './support/balanceFixture';
import { connectWallet, selectAsset } from './support/actions';

test('a wallet holding opens local-mint offers and URL filters survive pagination, Back, and reload', async ({
  page,
}) => {
  const { state, account } = await balanceFixture(page);
  const openai = state.deployment.assets.find((asset) => asset.symbol === 'OPENAI')!;
  const spacex = state.deployment.assets.find((asset) => asset.symbol === 'SPACEX')!;
  const local = state.deployment.localnet!;
  state.wallets[local.holder]!.accounts = [
    account(openai.mint, state.agreement.settlement, '2000000000'),
    account(state.deployment.usdcMint, local.holderUsdc, '10000000000'),
  ];
  const reads: URL[] = [];
  await page.route('**/api/offers**', (route) => {
    const url = new URL(route.request().url());
    reads.push(url);
    return route.fulfill({
      json: [{ ...state.agreement, underlyingMint: url.searchParams.get('mint') }],
      headers: url.searchParams.has('after') ? {} : { 'X-Next-Cursor': 'next-page' },
    });
  });
  await page.goto('/portfolio');
  await connectWallet(page, 'Test Wallet 1');
  const holding = page.getByRole('article', { name: 'OPENAI wallet balance', exact: true });
  await expect(holding.getByRole('link', { name: 'Find protection' })).toHaveAttribute(
    'href',
    `/offers?mint=${openai.mint}`,
  );
  await holding.getByRole('link', { name: 'Find protection' }).click();
  const selector = page.getByRole('combobox', { name: 'PreStocks token' });
  await expect(selector).toHaveValue('OPENAI · OpenAI PreStocks');
  await expect.poll(() => reads.at(-1)?.searchParams.get('mint')).toBe(openai.mint);
  await page.getByText('More filters', { exact: true }).click();
  await page.getByLabel('Minimum payout (USDC)').fill('5');
  await page.getByRole('button', { name: 'Find matching offers' }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('min_payout')).toBe('5000000');
  await page.getByRole('link', { name: 'Next agreements' }).click();
  await expect.poll(() => reads.at(-1)?.searchParams.get('after')).toBe('next-page');
  expect(new URL(page.url()).searchParams.get('mint')).toBe(openai.mint);
  expect(new URL(page.url()).searchParams.get('min_payout')).toBe('5000000');
  await selectAsset(page, 'SPACEX');
  await expect.poll(() => reads.at(-1)?.searchParams.get('mint')).toBe(spacex.mint);
  expect(new URL(page.url()).searchParams.has('after')).toBe(false);
  await page.goBack();
  await expect(selector).toHaveValue('OPENAI · OpenAI PreStocks');
  await expect(page.getByLabel('Minimum payout (USDC)')).toHaveValue('5');
  await expect.poll(() => reads.at(-1)?.searchParams.get('after')).toBe('next-page');
  await page.reload();
  await expect(selector).toHaveValue('OPENAI · OpenAI PreStocks');
  await expect(page.getByLabel('Minimum payout (USDC)')).toHaveValue('5');
  await expect.poll(() => reads.at(-1)?.searchParams.get('min_payout')).toBe('5000000');
  expect(reads.every((url) => url.searchParams.get('mint') !== openai.referenceMint)).toBe(true);
  expect(state.unexpected).toEqual([]);
});

test('agreement identity opens the exact official reference without changing the settlement network', async ({
  page,
}) => {
  const { state } = await balanceFixture(page);
  const asset = state.deployment.assets.find(
    (asset) => asset.mint === state.agreement.underlyingMint,
  )!;
  const snapshot: components['schemas']['OfficialCatalog'] = {
    network: 'solana:mainnet',
    genesisHash: registry.genesisHash,
    source: 'https://prestocks.com/api/prestocks',
    marketSource: { status: 'fresh', receivedAt: 1790219833, error: null },
    chainSource: { status: 'fresh', receivedAt: 1790219833, error: null },
    finalizedSlot: '449904022',
    assets: registry.assets.map((policy) => ({
      mint: policy.mint,
      name: policy.name,
      symbol: policy.symbol,
      policy,
      eligibility: 'compatible',
      reason: 'Verified read-only context; trading requires a matching deployment.',
      market: null,
      chain: null,
    })),
  };
  await page.route('**/api/assets/official', (route) => route.fulfill({ json: snapshot }));
  await page.goto(`/agreements/${state.agreement.address}`);
  await page.getByRole('button', { name: 'Token identity', exact: true }).click();
  const context = page.getByRole('link', { name: 'Verified issuer context' });
  await expect(context).toHaveAttribute('href', `/issuer-assets?q=${asset.referenceMint}`);
  await context.click();
  const search = page.getByLabel('Search official PreStocks');
  const catalog = page.getByRole('region', { name: 'Official assets' });
  await expect(search).toHaveValue(asset.referenceMint);
  await expect(catalog.getByRole('article')).toHaveCount(1);
  await expect(catalog.getByRole('heading', { name: asset.name })).toBeVisible();
  await expect(catalog).toContainText('SOLANA MAINNET · READ ONLY');
  await expect(page.getByText('LOCALNET DEMO', { exact: true })).toBeVisible();
  await search.fill('SPACEX');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('SPACEX');
  await expect(catalog.getByRole('heading', { name: 'SpaceX PreStocks' })).toBeVisible();
  await page.reload();
  await expect(search).toHaveValue('SPACEX');
  await search.clear();
  await expect(catalog.getByRole('article')).toHaveCount(registry.assets.length);
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/agreements/${state.agreement.address}$`));
  await expect(page.getByRole('button', { name: 'Token identity', exact: true })).toBeVisible();
  expect(state.unexpected).toEqual([]);
});

test('unsupported reference mints and malformed quantities cannot silently change offer discovery', async ({
  page,
}) => {
  const { state } = await balanceFixture(page);
  const asset = state.deployment.assets[0]!;
  const reads: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/offers') reads.push(request.url());
  });
  await page.goto(`/offers?mint=${asset.referenceMint}`);
  await expect(page.getByRole('alert')).toContainText('not available on the connected deployment');
  await expect(page.getByRole('link', { name: 'View offer', exact: true })).toHaveCount(0);
  expect(reads).toEqual([]);
  await page.goto(`/offers?mint=${asset.mint}&quantity_raw=1.5`);
  await expect(page.getByRole('alert')).toContainText('Invalid base-unit amount');
  expect(reads).toEqual([]);
  await page.getByRole('link', { name: 'Clear invalid filters' }).click();
  await expect(page.getByRole('combobox', { name: 'PreStocks token' })).toHaveValue(
    'All PreStocks',
  );
  await expect.poll(() => reads.length).toBeGreaterThan(0);
  expect(state.unexpected).toEqual([]);
});

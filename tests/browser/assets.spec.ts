import { expect, test } from '@playwright/test';
import type { Agreement, Deployment, Wallet } from '../../frontend/src/lib/api/client';
import { selectAsset } from './support/actions';
import { demoBalances } from '../../tools/localnet/assets';

test('PreStocks search selects actual mints, clears incompatible quantities and supports keyboard navigation', async ({
  page,
  request,
}, info) => {
  const config = (await (await request.get('/api/config')).json()) as Deployment;
  expect(config.assets).toHaveLength(8);
  const openai = config.assets.find((asset) => asset.symbol === 'OPENAI')!;
  const spacex = config.assets.find((asset) => asset.symbol === 'SPACEX')!;
  const requests: URL[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/offers') requests.push(new URL(request.url()));
  });
  await page.goto('/offers');
  const selector = page.getByRole('combobox', { name: 'PreStocks token' });
  await page.getByText('More filters', { exact: true }).click();
  await expect(page.getByLabel('Exact quantity (unscaled tokens)')).toBeDisabled();
  await selector.fill('not-a-supported-token');
  await expect(
    page.getByRole('form', { name: 'Find protection' }).getByRole('status'),
  ).toContainText('No supported PreStocks match');
  await selector.fill('OpenAI PreStocks');
  await expect(page.getByRole('option')).toHaveCount(1);
  await selector.press('Enter');
  await expect(selector).toHaveValue('OPENAI · OpenAI PreStocks');
  await expect.poll(() => requests.at(-1)?.searchParams.get('mint')).toBe(openai.mint);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article')).toContainText('OpenAI PreStocks');
  await page.getByLabel('Exact quantity (unscaled tokens)').fill('1');
  await page.getByRole('button', { name: 'Find matching offers' }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('quantity_raw')).toBe('1000000000');
  // A mainnet reference resolves to its LOCAL mint; mainnet can never enter a signing request.
  await selector.fill(spacex.referenceMint);
  await selector.press('ArrowDown');
  await selector.press('Enter');
  await expect.poll(() => requests.at(-1)?.searchParams.get('mint')).toBe(spacex.mint);
  expect(requests.at(-1)?.searchParams.has('quantity_raw')).toBe(false);
  await expect(page.getByLabel('Exact quantity (unscaled tokens)')).toHaveValue('');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article')).toContainText('SpaceX PreStocks');
  const offers = (await (
    await request.get(`/api/offers?mint=${spacex.mint}`)
  ).json()) as Agreement[];
  expect(
    offers.every((offer) => offer.underlyingMint === spacex.mint && offer.underlyingDecimals === 9),
  ).toBe(true);
  await selector.fill(openai.mint);
  await expect(page.getByRole('option')).toHaveCount(1);
  await selector.press('Escape');
  await expect(selector).toHaveValue('SPACEX · SpaceX PreStocks');
  await selector.click();
  await page.screenshot({ path: info.outputPath('token-search-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('token-search-mobile.png'), fullPage: true });
  await selector.press('Escape');
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(selector).toHaveValue('All PreStocks');
});

test('creation and signing review identify the selected PreStocks replica and wallet balances stay separate', async ({
  page,
  request,
}) => {
  const config = (await (await request.get('/api/config')).json()) as Deployment;
  const anthropic = config.assets.find((asset) => asset.symbol === 'ANTHROPIC')!;
  for (const owner of [config.localnet!.holder, config.localnet!.writer]) {
    const wallet = (await (await request.get(`/api/wallet?owner=${owner}`)).json()) as Wallet;
    for (const asset of config.assets) {
      const balances = wallet.accounts.filter((account) => account.mint === asset.mint);
      expect(balances).toHaveLength(1);
      expect(balances[0]!.decimals).toBe(asset.decimals);
      expect(balances[0]!.amountRaw).toBe(
        String(demoBalances.tokenUnits * 10n ** BigInt(asset.decimals)),
      );
    }
  }
  let submissions = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/rpc') && request.postDataJSON()?.method === 'sendTransaction')
      submissions++;
  });
  await page.goto('/offers/new');
  await page.getByRole('button', { name: 'Connect Test Wallet 2', exact: true }).click();
  await selectAsset(page, 'ANTHROPIC');
  await page.getByLabel('Gross quantity (unscaled tokens)', { exact: true }).fill('0.000000001');
  await page.getByRole('button', { name: 'Review funded offer' }).click();
  const review = page.getByRole('dialog');
  await expect(review).toContainText('Anthropic PreStocks');
  await expect(review).toContainText('0.000000001');
  await review.getByText('Token identity', { exact: true }).click();
  await expect(review).toContainText(anthropic.mint);
  await expect(review).toContainText(anthropic.referenceMint);
  await expect(review).toContainText('not issued by PreStocks');
  await expect(review.getByRole('link', { name: 'View on PreStocks' })).toHaveAttribute(
    'href',
    anthropic.source,
  );
  await review.getByRole('button', { name: 'Back', exact: true }).click();
  expect(submissions).toBe(0);
});

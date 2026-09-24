import { expect, test } from '@playwright/test';
import { balanceFixture } from './support/balanceFixture';

test('All combines wallet roles and keeps status selection through navigation, pagination and reload', async ({
  page,
}, info) => {
  const { state } = await balanceFixture(page);
  const d = state.deployment;
  const owner = d.localnet!.holder;
  const written = { ...state.agreement, writer: owner };
  const purchased = { ...state.agreement, address: d.authority, holder: owner, status: 'active' };
  const second = { ...purchased, address: d.usdcMint };
  const queries: URL[] = [];
  await page.route('**/api/agreements?*', (route) => {
    const url = new URL(route.request().url());
    queries.push(url);
    const query = url.searchParams;
    expect([query.get('owner'), query.get('holder'), query.get('writer')].filter(Boolean)).toEqual([
      owner,
    ]);
    const filtered = query.has('lifecycle');
    return route.fulfill({
      json: query.has('writer')
        ? filtered
          ? []
          : [written]
        : query.has('holder') || filtered
          ? query.has('after')
            ? [second]
            : [purchased]
          : [written, purchased],
      headers:
        filtered && !query.has('writer') && !query.has('after')
          ? { 'X-Next-Cursor': purchased.address }
          : {},
    });
  });
  await page.goto('/portfolio');
  await expect(
    page.getByRole('heading', { name: 'Your portfolio starts with your wallet' }),
  ).toBeVisible();
  expect(queries).toEqual([]);
  await page.getByRole('button', { name: 'Connect Test Wallet 1', exact: true }).click();
  const tabs = page.getByRole('navigation', { name: 'Portfolio views' });
  const cards = page.getByRole('article', { name: /^Agreement / });
  await expect(tabs.getByRole('link', { name: 'All', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: 'Written by your wallet' })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'Protection purchased by your wallet' })).toHaveCount(1);
  // The holder's payout must not be counted as capital this wallet wrote.
  await expect(
    page.getByText('Reserved in your funded and active offers on this page:', { exact: false }),
  ).toContainText('20 USDC');
  expect(queries.at(-1)!.searchParams.get('owner')).toBe(owner);
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`portfolio-all-${width}.png`), fullPage: true });
  }
  const status = page.getByRole('combobox', { name: 'Agreement status' });
  await status.selectOption('active');
  await expect(cards).toHaveCount(1);
  await expect(page).toHaveURL(/\/portfolio\?status=active$/);
  expect(queries.at(-1)!.searchParams.get('lifecycle')).toBe('active');
  await page.getByRole('link', { name: 'Next agreements' }).click();
  await expect.poll(() => queries.at(-1)!.searchParams.get('after')).toBe(purchased.address);
  await expect(cards.first()).toHaveAttribute('aria-label', `Agreement ${second.address}`);
  await tabs.getByRole('link', { name: 'My offers', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No agreements match this status' }),
  ).toBeVisible();
  expect(queries.at(-1)!.searchParams.get('writer')).toBe(owner);
  expect(queries.at(-1)!.searchParams.has('after')).toBe(false);
  await page.goBack();
  await expect(status).toHaveValue('active');
  await expect.poll(() => queries.at(-1)!.searchParams.get('after')).toBe(purchased.address);
  await page.reload();
  await expect(status).toHaveValue('active');
  await expect(cards.first()).toHaveAttribute('aria-label', `Agreement ${second.address}`);
  await tabs.getByRole('link', { name: 'My protection', exact: true }).click();
  await expect.poll(() => queries.at(-1)!.searchParams.get('holder')).toBe(owner);
  expect(queries.at(-1)!.searchParams.get('lifecycle')).toBe('active');
  expect(queries.at(-1)!.searchParams.has('after')).toBe(false);
  await status.selectOption('');
  await expect(page).toHaveURL(/\/portfolio\/protection$/);
  expect(queries.at(-1)!.searchParams.has('lifecycle')).toBe(false);
  await tabs.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(status).toHaveCount(0);
  await expect(cards).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No operations yet' })).toBeVisible();
  expect(state.unexpected).toEqual([]);
});

test('wallet switching clears the previous portfolio and unknown statuses cannot broaden the query', async ({
  page,
}) => {
  const { state } = await balanceFixture(page);
  const d = state.deployment;
  const queries: URL[] = [];
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/agreements?*', async (route) => {
    const url = new URL(route.request().url());
    queries.push(url);
    const owner = url.searchParams.get('owner');
    if (owner === d.localnet!.writer) await waiting;
    return route.fulfill({
      json:
        owner === d.localnet!.holder
          ? [{ ...state.agreement, status: 'exercised', holder: owner }]
          : [],
    });
  });
  await page.goto('/portfolio?status=unknown');
  await page.getByRole('button', { name: 'Connect Test Wallet 1', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Unknown agreement status');
  expect(queries).toEqual([]);
  await page.getByRole('link', { name: 'Clear status filter' }).click();
  const cards = page.getByRole('article', { name: /^Agreement / });
  await expect(cards).toHaveCount(1);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(cards).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect Test Wallet 2', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Loading agreements' })).toBeVisible();
  await expect(cards).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: 'No agreements yet' })).toBeVisible();
  expect(queries.at(-1)!.searchParams.get('owner')).toBe(d.localnet!.writer);
  expect(state.unexpected).toEqual([]);
});

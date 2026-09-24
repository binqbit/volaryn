import { expect, test } from '@playwright/test';
import type { Agreement } from '../../frontend/src/lib/api/client';
import { balanceFixture } from './support/balanceFixture';
import { connectWallet, selectAsset } from './support/actions';

test('creation defaults to a premium-backed request and switching sides changes the required funding', async ({
  page,
}) => {
  const { state, account } = await balanceFixture(page);
  const local = state.deployment.localnet!;
  state.wallets[local.holder]!.accounts = [
    account(state.deployment.usdcMint, local.holderUsdc, '1000000'),
  ];
  await page.goto('/offers/new');
  await connectWallet(page);
  const sides = page.getByRole('group', { name: 'Offer side', exact: true });
  await expect(
    sides.getByRole('button', { name: 'Request protection', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await selectAsset(page, 'OPENAI');
  await page.getByLabel('Payout (USDC)', { exact: true }).fill('20');
  await page.getByLabel('Premium (USDC)', { exact: true }).fill('0.5');
  const funding = page.getByRole('group', { name: 'Funding USDC account balance' });
  await expect(funding).toContainText('Premium to escrow');
  await expect(page.getByRole('button', { name: 'Review protection request' })).toBeEnabled();
  await expect(page.getByRole('group', { name: 'OPENAI holdings' })).toContainText(
    'Your tokens stay in your wallet',
  );
  await sides.getByRole('button', { name: 'Provide protection', exact: true }).click();
  await expect(funding).toContainText('Payout to reserve');
  await expect(funding).toContainText('Shortfall');
  await expect(funding).toContainText('19 USDC');
  await expect(page.getByRole('button', { name: 'Review funded offer' })).toBeDisabled();
  await sides.getByRole('button', { name: 'Request protection', exact: true }).click();
  await expect(page.getByLabel('Payout (USDC)', { exact: true })).toHaveValue('20');
  await expect(page.getByLabel('Premium (USDC)', { exact: true })).toHaveValue('0.5');
  await expect(page.getByRole('button', { name: 'Review protection request' })).toBeEnabled();
  expect(state.unexpected).toEqual([]);
});

test('offer side tabs retain filters and exclude either kind of own offer without mixing escrow labels', async ({
  page,
}) => {
  const { state } = await balanceFixture(page);
  const d = state.deployment;
  const owner = d.localnet!.holder;
  const foreignBuy = state.agreement;
  const ownRequest: Agreement = {
    ...foreignBuy,
    address: d.authority,
    side: 'holder',
    creator: owner,
    holder: owner,
    writer: null,
    reserveAmount: foreignBuy.premium,
  };
  const foreignRequest: Agreement = {
    ...ownRequest,
    address: d.usdcMint,
    creator: d.authority,
    holder: d.authority,
  };
  const ownBuy: Agreement = {
    ...foreignBuy,
    address: d.localnet!.holderUsdc,
    creator: owner,
    writer: owner,
  };
  state.offers = [foreignBuy, ownRequest, foreignRequest, ownBuy];
  const reads: URL[] = [];
  await page.route('**/api/offers**', (route) => {
    const url = new URL(route.request().url());
    reads.push(url);
    const side = url.searchParams.get('side');
    return route.fulfill({
      // Return own offers too: the browser must independently exclude the creator.
      json: state.offers.filter((offer) => !side || offer.side === side),
      headers:
        side === 'holder' && !url.searchParams.has('after') ? { 'X-Next-Cursor': d.authority } : {},
    });
  });
  await page.goto('/offers');
  const cards = page.getByRole('article', { name: /^Agreement / });
  const tabs = page.getByRole('navigation', { name: 'Offer sides' });
  await expect(tabs.getByRole('link', { name: 'All offers', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(cards).toHaveCount(4);
  await expect(cards.filter({ hasText: 'Sell request' })).toHaveCount(2);
  await expect(cards.filter({ hasText: 'Buy offer' })).toHaveCount(2);
  await connectWallet(page);
  await expect(cards).toHaveCount(2);
  await expect.poll(() => reads.at(-1)?.searchParams.get('eligible_counterparty')).toBe(owner);
  await expect(
    page.getByRole('article', { name: `Agreement ${ownRequest.address}`, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('article', { name: `Agreement ${ownBuy.address}`, exact: true }),
  ).toHaveCount(0);
  await selectAsset(page, 'OPENAI');
  await page.getByText('More filters', { exact: true }).click();
  await page.getByLabel('Minimum payout (USDC)').fill('1');
  await page.getByRole('button', { name: 'Find matching offers' }).click();
  await tabs.getByRole('link', { name: 'Sell requests', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Awaiting payout funding');
  await expect(cards).not.toContainText('Payout reserved');
  expect(new URL(page.url()).searchParams.get('min_payout')).toBe('1000000');
  expect(new URL(page.url()).searchParams.get('mint')).toBe(foreignBuy.underlyingMint);
  await page.getByRole('link', { name: 'Next agreements' }).click();
  await expect.poll(() => reads.at(-1)?.searchParams.get('after')).toBe(d.authority);
  await tabs.getByRole('link', { name: 'Buy offers', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Payout reserved');
  expect(new URL(page.url()).searchParams.has('after')).toBe(false);
  expect(new URL(page.url()).searchParams.get('side')).toBe('writer');
  await page.goBack();
  await expect(tabs.getByRole('link', { name: 'Sell requests', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect.poll(() => reads.at(-1)?.searchParams.get('after')).toBe(d.authority);
  await page.reload();
  await expect(cards).toContainText('Sell request');
  await tabs.getByRole('link', { name: 'All offers', exact: true }).click();
  await expect(cards).toHaveCount(2);
  expect(new URL(page.url()).searchParams.has('side')).toBe(false);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(cards).toHaveCount(4);
  expect(state.unexpected).toEqual([]);
});

test('portfolio separates escrowed request premiums from payout capital across both origins', async ({
  page,
}, info) => {
  const { state } = await balanceFixture(page);
  const d = state.deployment;
  const owner = d.localnet!.holder;
  const ownBuy: Agreement = { ...state.agreement, creator: owner, writer: owner };
  const request: Agreement = {
    ...state.agreement,
    address: d.authority,
    creator: owner,
    side: 'holder',
    writer: null,
    holder: owner,
    reserveAmount: state.agreement.premium,
  };
  const purchased: Agreement = {
    ...state.agreement,
    address: d.usdcMint,
    status: 'active',
    holder: owner,
  };
  const fundedRequest: Agreement = {
    ...state.agreement,
    address: d.localnet!.writerUsdc,
    side: 'holder',
    creator: d.authority,
    holder: d.authority,
    writer: owner,
    status: 'active',
  };
  const agreements = [ownBuy, request, purchased, fundedRequest];
  await page.route('**/api/agreements?*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({
      json: agreements.filter((item) =>
        query.has('writer')
          ? item.writer === owner
          : query.has('holder')
            ? item.holder === owner
            : item.creator === owner || item.writer === owner || item.holder === owner,
      ),
    });
  });
  await page.goto('/portfolio');
  await connectWallet(page);
  const cards = page.getByRole('article', { name: /^Agreement / });
  await expect(cards).toHaveCount(4);
  await expect(
    cards.filter({ hasText: 'Requested by your wallet · premium escrowed' }),
  ).toHaveCount(1);
  await expect(
    page.getByText('Payout reserved in your open and active capital commitments on this page:', {
      exact: false,
    }),
  ).toContainText('40 USDC');
  await expect(
    page.getByText('Premium escrowed in your unaccepted requests on this page:', { exact: false }),
  ).toContainText('0.5 USDC');
  const tabs = page.getByRole('navigation', { name: 'Portfolio views' });
  await tabs.getByRole('link', { name: 'My protection', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect(
    page.getByRole('article', { name: `Agreement ${request.address}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: `Agreement ${purchased.address}`, exact: true }),
  ).toBeVisible();
  await tabs.getByRole('link', { name: 'My offers', exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect(
    page.getByRole('article', { name: `Agreement ${fundedRequest.address}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('article', { name: `Agreement ${ownBuy.address}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Premium escrowed in your unaccepted requests on this page:', { exact: false }),
  ).toHaveCount(0);
  await tabs.getByRole('link', { name: 'All', exact: true }).click();
  await page.setViewportSize({ width: 375, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('portfolio-both-origins.png'), fullPage: true });
  expect(state.unexpected).toEqual([]);
});

test('an unknown side does not broaden discovery into all offers', async ({ page }) => {
  const { state } = await balanceFixture(page);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/offers') requests.push(request.url());
  });
  await page.goto('/offers?side=unexpected');
  await expect(page.getByRole('alert')).toContainText('Unknown offer side');
  expect(requests).toEqual([]);
  await page.getByRole('link', { name: 'Clear invalid filters' }).click();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(state.unexpected).toEqual([]);
});

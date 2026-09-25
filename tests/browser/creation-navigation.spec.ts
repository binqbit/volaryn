import { expect, test } from '@playwright/test';
import type { Deployment } from '../../frontend/src/lib/api/client';
import { connectWallet, selectAsset } from './support/actions';

// Real localnet reads only: these journeys prepare drafts but never sign or submit.
test('wallet shortcuts replace the open draft token and origin, including Back and Forward', async ({
  page,
  request,
}) => {
  const deployment = (await (await request.get('/api/config')).json()) as Deployment;
  const anthropic = deployment.assets.find((asset) => asset.symbol === 'ANTHROPIC')!;
  const spacex = deployment.assets.find((asset) => asset.symbol === 'SPACEX')!;
  await page.goto(`/offers/new?mint=${anthropic.mint}&side=writer`);
  await connectWallet(page, 'Test Wallet 1');
  const selector = page.getByRole('combobox', { name: 'PreStocks token' });
  const requestSide = page.getByRole('button', { name: 'Request protection', exact: true });
  const writerSide = page.getByRole('button', { name: 'Provide protection', exact: true });
  await expect(selector).toHaveValue('ANTHROPIC · Anthropic PreStocks');
  await expect(writerSide).toHaveAttribute('aria-pressed', 'true');

  await page
    .getByRole('article', { name: 'SPACEX wallet balance', exact: true })
    .getByRole('link', { name: 'Request protection', exact: true })
    .click();
  await expect(selector).toHaveValue('SPACEX · SpaceX PreStocks');
  await expect(requestSide).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Review protection request' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('mint')).toBe(spacex.mint);

  await page.goBack();
  await expect(selector).toHaveValue('ANTHROPIC · Anthropic PreStocks');
  await expect(writerSide).toHaveAttribute('aria-pressed', 'true');
  await page.goForward();
  await expect(selector).toHaveValue('SPACEX · SpaceX PreStocks');
  await expect(requestSide).toHaveAttribute('aria-pressed', 'true');
});

test('ordinary refreshes and dropdown edits preserve a draft, while a same-URL shortcut restarts it', async ({
  page,
  request,
}) => {
  const deployment = (await (await request.get('/api/config')).json()) as Deployment;
  const anthropic = deployment.assets.find((asset) => asset.symbol === 'ANTHROPIC')!;
  await page.goto(`/offers/new?mint=${anthropic.mint}`);
  await connectWallet(page, 'Test Wallet 1');
  const selector = page.getByRole('combobox', { name: 'PreStocks token' });
  await expect(selector).toHaveValue('ANTHROPIC · Anthropic PreStocks');
  await expect(page.getByRole('button', { name: 'Apply suggested dates' })).toBeEnabled();
  const form = page.getByRole('form', { name: 'Create an offer' });
  const premium = form.getByLabel('Premium (USDC)', { exact: true });
  const expiry = form.getByLabel('Protection expiry (UTC)', { exact: true });
  const editedExpiry = new Date(Date.now() + 86_400_000).toISOString().slice(0, 19);
  await premium.fill('12.345678');
  await expiry.fill(editedExpiry);
  await page.getByRole('button', { name: 'Provide protection', exact: true }).click();
  await selectAsset(page, 'SPACEX');
  await expect(selector).toHaveValue('SPACEX · SpaceX PreStocks');
  await expect(premium).toHaveValue('12.345678');
  await expect(expiry).toHaveValue(editedExpiry);
  const draftUrl = page.url();

  // Observe a real periodic wallet response; no mocked API or fixed sleep.
  await page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/wallet' && response.ok();
  });
  await expect(premium).toHaveValue('12.345678');
  await expect(expiry).toHaveValue(editedExpiry);
  await expect(selector).toHaveValue('SPACEX · SpaceX PreStocks');
  await expect(
    page.getByRole('button', { name: 'Provide protection', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page
    .getByRole('article', { name: 'ANTHROPIC wallet balance', exact: true })
    .getByRole('link', { name: 'Request protection', exact: true })
    .click();
  expect(page.url()).toBe(draftUrl);
  await expect(selector).toHaveValue('ANTHROPIC · Anthropic PreStocks');
  await expect(
    page.getByRole('button', { name: 'Request protection', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(premium).toHaveValue('10');
});

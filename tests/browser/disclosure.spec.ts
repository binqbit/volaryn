import { expect, test } from '@playwright/test';
import { shortAddress } from '../../frontend/src/lib/api/client';
import { balanceFixture } from './support/balanceFixture';
import { connectWallet, selectAsset } from './support/actions';
import { documentBox } from './support/layout';

test('offer filters are optional, keyboard accessible, and retain applied criteria when collapsed', async ({
  page,
}, info) => {
  const { state } = await balanceFixture(page);
  state.offers = [
    state.agreement,
    {
      ...state.agreement,
      address: state.deployment.authority,
      underlyingMint: state.deployment.assets[1]!.mint,
      payout: '35000000',
      premium: '750000',
    },
  ];
  await page.goto('/offers');
  const filters = page.getByRole('form', { name: 'Find protection' });
  const summary = filters.locator('summary').filter({ hasText: 'More filters' });
  await expect(page.getByRole('link', { name: 'View offer', exact: true })).toHaveCount(2);
  await expect(filters.getByLabel('Minimum payout (USDC)')).not.toBeVisible();
  await expect(page.getByText('LOCALNET DEMO', { exact: true })).toBeVisible();
  await expect(page.getByText('Try the full workflow', { exact: false })).not.toBeVisible();
  await page.screenshot({ path: info.outputPath('offers-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('offers-mobile.png'), fullPage: true });
  await summary.focus();
  await summary.press('Enter');
  await expect(filters.getByLabel('Minimum payout (USDC)')).toBeVisible();
  await selectAsset(page, 'OPENAI');
  await filters.getByLabel('Exact quantity (unscaled tokens)').fill('0.25');
  await filters.getByLabel('Minimum payout (USDC)').fill('5');
  const query = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === '/api/offers' && url.searchParams.get('min_payout') === '5000000';
  });
  await filters.getByRole('button', { name: 'Find matching offers' }).click();
  expect(new URL((await query).url()).searchParams.get('quantity_raw')).toBe('250000000');
  await summary.press('Space');
  await expect(filters.getByLabel('Minimum payout (USDC)')).not.toBeVisible();
  await expect(summary).toContainText('2 applied');
  const box = await documentBox(filters);
  await page.waitForResponse('**/api/offers?*');
  expect(await documentBox(filters)).toEqual(box);
  await summary.press('Enter');
  await expect(filters.getByLabel('Exact quantity (unscaled tokens)')).toHaveValue('0.25');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Create offer', exact: true })
    .click();
  await expect(page).toHaveURL(/\/offers\/new$/);
  // Browser history returns to the exact filtered URL; plain market navigation starts anew.
  await page.goBack();
  await expect(summary).toContainText('2 applied');
  await summary.click();
  await expect(filters.getByLabel('Minimum payout (USDC)')).toHaveValue('5');
  await summary.click();
  await filters.getByRole('button', { name: 'Reset filters' }).click();
  await expect(summary).not.toContainText('applied');
  await expect(filters.getByRole('combobox')).toHaveValue('All PreStocks');
  await summary.click();
  await filters.getByLabel('Minimum payout (USDC)').fill('not-an-amount');
  await filters.getByRole('button', { name: 'Find matching offers' }).click();
  await expect(filters.getByRole('alert')).toBeVisible();
  await summary.click();
  await expect(filters.getByRole('alert')).toBeVisible();
  expect(state.unexpected).toEqual([]);
});

test('creation shows wallet information directly while holder restrictions remain optional', async ({
  page,
}, info) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  state.wallets[d.localnet!.writer]!.accounts = [
    account(d.usdcMint, d.localnet!.writerUsdc, '100000000'),
    ...d.assets.map((asset) => account(asset.mint, asset.mint, '2000000000')),
  ];
  await page.goto('/offers/new');
  await connectWallet(page, 'Test Wallet 2');
  await selectAsset(page, 'OPENAI');
  const form = page.getByRole('form', { name: 'Create an offer' });
  const wallet = page.getByRole('region', { name: 'Your wallet' });
  const restriction = form.locator('summary').filter({ hasText: 'Restrict to a wallet' });
  const designated = form.getByLabel('Designated holder (optional)');
  await expect(designated).not.toBeVisible();
  await expect(form.getByLabel('Acceptance deadline (UTC)')).toBeVisible();
  await expect(form.getByLabel('Protection expiry (UTC)')).toBeVisible();
  await expect(form.getByRole('group', { name: 'Funding USDC account balance' })).toContainText(
    '100 USDC',
  );
  await expect(form.getByRole('group', { name: 'OPENAI holdings' })).toContainText('2 OPENAI');
  await expect(wallet.getByRole('group', { name: 'USDC balance', exact: true })).toBeVisible();
  await expect(wallet.getByRole('article')).toHaveCount(8);
  await expect(wallet.getByText(d.localnet!.writer, { exact: true })).toBeVisible();
  await expect(wallet.locator('details')).toHaveCount(0);
  const token = wallet.getByRole('article', { name: 'OPENAI wallet balance' });
  await expect(token.getByText('OpenAI PreStocks', { exact: true })).toBeVisible();
  await expect(token.locator('strong').first()).toHaveText('2');
  await expect(token.getByRole('list', { name: 'OPENAI token accounts' })).toContainText(
    d.assets[0]!.mint,
  );
  await expect(token.getByRole('list')).not.toContainText('2 OPENAI');
  await expect(token.getByText(d.assets[0]!.mint, { exact: true })).toBeVisible();
  const usdc = wallet.getByRole('group', { name: 'USDC balance', exact: true });
  await expect(usdc.getByText(d.localnet!.writerUsdc, { exact: true })).toBeVisible();
  const walletBox = await documentBox(wallet);
  await page.waitForResponse('**/api/wallet?*');
  expect(await documentBox(wallet)).toEqual(walletBox);
  await page.screenshot({ path: info.outputPath('create-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('create-mobile.png'), fullPage: true });
  await restriction.click();
  await designated.fill(d.localnet!.holder);
  await restriction.click();
  await expect(restriction).toContainText(shortAddress(d.localnet!.holder));
  await restriction.click();
  await expect(designated).toHaveValue(d.localnet!.holder);
  await designated.fill('not-a-wallet');
  await restriction.click();
  await form.getByRole('button', { name: 'Review funded offer' }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await expect(designated).toBeVisible();
  await expect(designated).toBeFocused();
  expect(state.unexpected).toEqual([]);
});

test('agreement costs, deadlines and blocking warnings stay visible with technical details collapsed', async ({
  page,
}, info) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  state.wallets[d.localnet!.holder]!.accounts = [
    account(d.usdcMint, d.localnet!.holderUsdc, '300000'),
  ];
  await page.goto(`/agreements/${state.agreement.address}`);
  await connectWallet(page, 'Test Wallet 1');
  const agreement = page.getByRole('article', {
    name: `Agreement ${state.agreement.address}`,
    exact: true,
  });
  await expect(agreement.getByText('Activation premium', { exact: true })).toBeVisible();
  await expect(agreement.getByText('Acceptance deadline', { exact: true })).toBeVisible();
  await expect(agreement.getByText('Protection expires', { exact: true })).toBeVisible();
  await expect(agreement.getByText('The selected account cannot cover this amount.')).toBeVisible();
  await expect(agreement.getByText('Issuer transfer fees reduce', { exact: false })).toBeVisible();
  await expect(agreement.getByRole('button', { name: 'Activate protection' })).toBeDisabled();
  await expect(agreement.getByText(state.agreement.reserve, { exact: true })).not.toBeVisible();
  await page.screenshot({ path: info.outputPath('agreement-desktop.png'), fullPage: true });
  const details = agreement.getByRole('button', { name: /^On-chain details/ });
  const box = await documentBox(agreement);
  await details.focus();
  await details.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'On-chain details', exact: true });
  await expect(dialog.getByText(state.agreement.reserve, { exact: true })).toBeVisible();
  expect(
    await documentBox(
      page.getByRole('article', {
        name: `Agreement ${state.agreement.address}`,
        exact: true,
        includeHidden: true,
      }),
    ),
  ).toEqual(box);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(details).toBeFocused();
  await expect(agreement.getByRole('button', { name: 'Activate protection' })).toBeDisabled();
  await expect(agreement.getByText(state.agreement.reserve, { exact: true })).not.toBeVisible();
  expect(state.unexpected).toEqual([]);
});

import { expect, test } from '@playwright/test';
import { balanceFixture } from './support/balanceFixture';
import { connectWallet, selectAsset } from './support/actions';

test('creation shows token holdings and funds the payout from the selected USDC account only', async ({
  page,
}, info) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  const mint = d.assets[0]!.mint;
  state.wallets[d.localnet!.writer]!.accounts = [
    account(d.usdcMint, d.localnet!.writerUsdc, '30500001'),
    account(d.usdcMint, d.localnet!.holderUsdc, '12000000'),
    account(d.usdcMint, d.authority, '500000000', true),
    account(mint, d.localnet!.writer, '1234567890'),
    account(mint, d.localnet!.holder, '2000000000', true),
  ];
  await page.goto('/offers/new');
  await connectWallet(page, 'Test Wallet 2');
  await page.getByRole('button', { name: 'Provide protection', exact: true }).click();
  await selectAsset(page, 'OPENAI');
  const holdings = page.getByRole('group', { name: 'OPENAI holdings' });
  await expect(holdings).toContainText('3.23456789 OPENAI');
  await expect(holdings).toContainText('Unfrozen: 1.23456789 OPENAI · Frozen: 2 OPENAI');
  await expect(holdings).toContainText('You fund this offer with USDC');
  const holdingCard = page.getByRole('article', { name: 'OPENAI wallet balance' });
  await expect(holdingCard).toContainText('3.23456789');
  await expect(holdingCard.getByText('Unfrozen 1.23456789 · Frozen 2')).toBeVisible();
  const usdcCard = page.getByRole('group', { name: 'USDC balance', exact: true });
  await expect(usdcCard).toHaveCount(1);
  await expect(usdcCard.locator('strong').first()).toHaveText('42.500001');
  await expect(usdcCard.getByText('Available test USDC', { exact: true })).toBeVisible();
  await expect(usdcCard).toContainText('Frozen: 500 test USDC');
  expect((await usdcCard.boundingBox())!.y).toBeLessThan((await holdingCard.boundingBox())!.y);
  await expect(page.getByText('Token accounts and balances', { exact: true })).toHaveCount(0);
  await expect(holdingCard.getByText(d.localnet!.writer, { exact: true })).toBeVisible();
  await expect(holdingCard.getByText('OpenAI PreStocks', { exact: true })).toBeVisible();
  const tokenAccounts = holdingCard.getByRole('list', { name: 'OPENAI token accounts' });
  await expect(tokenAccounts.getByRole('listitem')).toHaveCount(2);
  await expect(tokenAccounts).toContainText('1.23456789 OPENAI');
  await expect(
    tokenAccounts.getByRole('listitem').filter({ hasText: d.localnet!.holder }),
  ).toContainText('Frozen');
  const usdcAccounts = usdcCard.getByRole('list', { name: 'test USDC token accounts' });
  await expect(usdcAccounts.getByRole('listitem')).toHaveCount(3);
  await expect(usdcAccounts).toContainText('30.500001 test USDC');
  await expect(usdcAccounts).not.toContainText('OPENAI');
  await page.waitForResponse('**/api/wallet?*');
  await expect(tokenAccounts).toBeVisible();
  await expect(usdcAccounts).toBeVisible();
  await page.setViewportSize({ width: 375, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('account-details-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByLabel('Payout (USDC)', { exact: true }).fill('20');
  const funding = page.getByRole('group', { name: 'Funding USDC account balance' });
  await expect(funding).toContainText('30.500001 USDC');
  await expect(funding).toContainText('10.500001 USDC');
  const review = page.getByRole('button', { name: 'Review funded offer' });
  await page.getByLabel('Payout (USDC)', { exact: true }).fill('31');
  await expect(funding).toContainText('Shortfall');
  await expect(funding).toContainText('0.499999 USDC');
  await expect(review).toBeDisabled();
  await page
    .getByRole('combobox', { name: 'Funding USDC account', exact: true })
    .selectOption(d.localnet!.holderUsdc);
  await expect(funding).toContainText('19 USDC');
  await page.getByRole('button', { name: 'Use full USDC balance' }).click();
  await expect(page.getByLabel('Payout (USDC)', { exact: true })).toHaveValue('12');
  await expect(funding).toContainText('Remaining after this action');
  await expect(review).toBeEnabled();
  await expect(
    page
      .getByRole('combobox', { name: 'Funding USDC account', exact: true })
      .getByRole('option', { name: /frozen/ }),
  ).toHaveJSProperty('disabled', true);
  await page.screenshot({ path: info.outputPath('create-balances-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('create-balances-mobile.png'), fullPage: true });
  await selectAsset(page, 'SPACEX');
  await expect(page.getByRole('group', { name: 'SPACEX holdings' })).toContainText('0 SPACEX');
  // A writer buys tokens on exercise; owning those tokens must not limit offer creation.
  await expect(review).toBeEnabled();
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(funding).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'SPACEX holdings' })).toHaveCount(0);
  await expect(usdcCard).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});

test('activation exposes premium affordability and exercise exposes the full single-account delivery requirement', async ({
  page,
}, info) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  const mint = d.assets[0]!.mint;
  const balances = (state.wallets[d.localnet!.holder]!.accounts = [
    account(d.usdcMint, d.localnet!.holderUsdc, '300000'),
    account(d.usdcMint, d.localnet!.writerUsdc, '250000'),
    account(d.usdcMint, d.authority, '1000000', true),
  ]);
  await page.goto(`/agreements/${state.agreement.address}`);
  await connectWallet(page, 'Test Wallet 1');
  const usdc = page.getByRole('group', { name: 'USDC account balance' });
  await expect(usdc).toContainText('Premium to activate');
  await expect(usdc).toContainText('0.5 USDC');
  await expect(usdc).toContainText('0.2 USDC');
  await expect(page.getByRole('button', { name: 'Activate protection' })).toBeDisabled();
  balances[0]!.amountRaw = '1000000';
  await expect(usdc).toContainText('Remaining after this action');
  await expect(page.getByRole('button', { name: 'Activate protection' })).toBeEnabled();
  await expect(page.getByRole('group', { name: 'OPENAI holdings' })).toContainText('0 OPENAI');
  await page.screenshot({ path: info.outputPath('activation-balances.png'), fullPage: true });
  state.agreement = { ...state.agreement, status: 'active', holder: d.localnet!.holder };
  balances.push(
    account(mint, d.localnet!.writer, '600000000'),
    account(mint, d.localnet!.holder, '600000000'),
    account(mint, mint, '2000000000', true),
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  const delivery = page.getByRole('group', { name: 'Delivery token account balance' });
  await expect(page.getByRole('group', { name: 'OPENAI holdings' })).toContainText('3.2 OPENAI');
  await expect(delivery).toContainText('Quantity to deliver');
  await expect(delivery).toContainText('0.4 OPENAI');
  await expect(page.getByRole('button', { name: 'Exercise protection' })).toBeDisabled();
  balances[3]!.amountRaw = '1250000000';
  await page
    .getByRole('combobox', { name: 'Delivery token account', exact: true })
    .selectOption(d.localnet!.writer);
  await expect(delivery).toContainText('0.25 OPENAI');
  await expect(page.getByRole('button', { name: 'Exercise protection' })).toBeEnabled();
  expect(state.unexpected).toEqual([]);
});

test('loading and failed observations are not zero balances or permission to spend', async ({
  page,
}) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  state.wallets[d.localnet!.holder]!.accounts = [
    account(d.usdcMint, d.localnet!.holderUsdc, '1500000'),
  ];
  let release = () => {};
  state.walletDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.goto(`/agreements/${state.agreement.address}`);
  await connectWallet(page, 'Test Wallet 1');
  const usdc = page.getByRole('group', { name: 'USDC account balance' });
  await expect(usdc).toContainText('Loading…');
  const wallet = page.getByRole('region', { name: 'Your wallet' });
  const balance = wallet.getByRole('group', { name: 'USDC balance', exact: true });
  await expect(wallet).toContainText("Loading this wallet's balances…");
  await expect(balance).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'OPENAI holdings' })).toContainText(
    'Loading balance…',
  );
  await expect(page.getByRole('button', { name: 'Activate protection' })).toBeDisabled();
  release();
  await expect(usdc).toContainText('1.5 USDC');
  await expect(balance.locator('strong').first()).toHaveText('1.5');
  await expect(page.getByRole('button', { name: 'Activate protection' })).toBeEnabled();
  state.walletUnavailable = true;
  await expect(usdc).toContainText('Last known in selected account');
  await expect(usdc).toContainText('1.5 USDC');
  await expect(usdc).toContainText('Balance unavailable');
  await expect(balance).toContainText('Unavailable · last known');
  await expect(page.getByRole('button', { name: 'Activate protection' })).toBeDisabled();
  state.walletUnavailable = false;
  state.wallets[d.localnet!.holder]!.accounts = [];
  await expect(usdc).toContainText('Available in selected account');
  await expect(usdc).toContainText('0 USDC');
  await expect(page.getByRole('button', { name: 'Activate protection' })).toBeDisabled();
  expect(state.unexpected).toEqual([]);
});

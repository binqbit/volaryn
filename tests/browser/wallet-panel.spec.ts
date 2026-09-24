import { expect, test } from '@playwright/test';
import { balanceFixture } from './support/balanceFixture';
import { connectWallet, selectAsset } from './support/actions';

for (const width of [1440, 375, 320]) {
  test(`wallet panel is the single balance view across routes at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 900 });
    const { state, account } = await balanceFixture(page);
    const d = state.deployment;
    const funds = account(d.usdcMint, d.localnet!.writerUsdc, '1234500001');
    const tokens = d.assets.map((asset) => account(asset.mint, asset.mint, '100000000000'));
    state.wallets[d.localnet!.writer]!.accounts = [
      funds,
      account(d.usdcMint, d.localnet!.holderUsdc, '500000000', true),
      ...tokens,
    ];
    await page.goto('/');
    const removedBar = page.getByRole('region', { name: 'Wallet balance', exact: true });
    await expect(removedBar).toHaveCount(0);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toContainText('Set a price floor');
    await expect(heading).toContainText('PreStocks');
    const example = page.getByRole('group', { name: 'PreStocks price floor example' });
    await expect(example).toContainText('10 OPENAI PreStocks tokens');
    await expect(example).toContainText('30 USDC premium · 30 days');
    await expect(example).toContainText('800 USDC reserved');
    await expect(example).toContainText('80 USDC per token');
    await expect(example).toContainText('not a live offer');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('home.png'), fullPage: true });

    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    await navigation.getByRole('link', { name: 'Create offer', exact: true }).click();
    await connectWallet(page, 'Test Wallet 2');
    await page.getByRole('button', { name: 'Provide protection', exact: true }).click();
    await selectAsset(page, 'OPENAI');
    const balance = page.getByRole('group', { name: 'USDC balance', exact: true });
    await expect(balance).toHaveCount(1);
    await expect(balance.locator('strong').first()).toHaveText('1234.500001');
    await expect(balance.getByText('Available test USDC', { exact: true })).toBeVisible();
    await expect(removedBar).toHaveCount(0);
    const header = page.getByRole('banner');
    await expect(header).not.toContainText('USDC');
    expect(
      await balance
        .locator('strong')
        .first()
        .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    ).toBeGreaterThanOrEqual(22);
    await header.getByRole('link', { name: /View wallet/ }).click();
    await expect(page).toHaveURL(/\/portfolio#wallet$/);
    const wallet = page.getByRole('region', { name: 'Your wallet', exact: true });
    await expect(wallet).toBeInViewport();
    await expect(balance.locator('strong').first()).toBeInViewport({ ratio: 1 });
    const holdings = wallet.getByRole('region', { name: 'PreStocks demo balances', exact: true });
    await expect(holdings).not.toContainText("PreStocks balances exclude the issuer's display");
    await expect(holdings).not.toContainText('This is a provided test wallet.');
    await expect(wallet.getByText(/^PreStocks balances exclude/)).toBeVisible();
    await expect(wallet.getByText(/^This is a provided test wallet/)).toBeVisible();
    await expect
      .poll(() => holdings.evaluate((node) => node.scrollHeight > node.clientHeight))
      .toBe(true);
    if (width > 800) {
      await expect(wallet).toHaveAttribute('data-bounded', 'true');
      const box = await wallet.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(900);
    }
    await page.screenshot({ path: info.outputPath('wallet-panel.png') });
    const usdcBeforeScroll = await balance.boundingBox();
    await holdings.focus();
    await holdings.press('End');
    const lastToken = wallet.getByRole('article').last();
    await lastToken.getByRole('link', { name: 'Find protection' }).focus();
    await expect(lastToken.getByRole('link', { name: 'Find protection' })).toBeInViewport();
    if (width > 800) expect(await balance.boundingBox()).toEqual(usdcBeforeScroll);
    await wallet
      .getByRole('article')
      .first()
      .getByRole('link', { name: 'Find protection' })
      .focus();
    await holdings.evaluate((node) => {
      node.scrollTop = 0;
    });
    funds.amountRaw = '18446744073709551615';
    await expect(balance.locator('strong').first()).toHaveText('18446744073709.551615');
    await expect(wallet.getByRole('article')).toHaveCount(d.assets.length);
    const token = wallet.getByRole('article', { name: `${d.assets[0]!.symbol} wallet balance` });
    await expect(token.getByText(d.assets[0]!.name, { exact: true })).toBeVisible();
    await expect(token.getByText(tokens[0]!.address, { exact: true })).toBeVisible();
    await expect(wallet.locator('details')).toHaveCount(0);
    await expect(token.locator('strong').first()).toHaveText('100');
    tokens[0]!.amountRaw = '18446744073709551615';
    await expect(token.locator('strong').first()).toHaveText('18446744073.709551615');
    await expect(token.getByRole('list')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath('wallet-token-cards.png') });

    await navigation.getByRole('link', { name: 'Home', exact: true }).click();
    await expect(wallet).toHaveCount(0);
    await expect(balance).toHaveCount(0);
    await expect(removedBar).toHaveCount(0);
    await expect(header.getByRole('link', { name: /View wallet/ })).toBeVisible();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(header.getByRole('link', { name: /View wallet/ })).toHaveCount(0);
    expect(state.unexpected).toEqual([]);
  });
}

test('desktop wallet fits on entry and stays pinned while the form and holdings scroll independently', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  state.wallets[d.localnet!.writer]!.accounts = [
    account(d.usdcMint, d.localnet!.writerUsdc, '10000000000'),
    ...d.assets.map((asset) => account(asset.mint, asset.mint, '100000000000')),
  ];
  await page.goto('/offers/new');
  await connectWallet(page, 'Test Wallet 2');
  await page.getByRole('button', { name: 'Provide protection', exact: true }).click();
  const wallet = page.getByRole('region', { name: 'Your wallet', exact: true });
  const holdings = wallet.getByRole('region', { name: 'PreStocks demo balances', exact: true });
  await expect(wallet).toHaveAttribute('data-bounded', 'true');
  await expect
    .poll(async () => {
      const box = (await wallet.boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(876);
  await page.screenshot({ path: info.outputPath('wallet-entry.png') });
  // Stay within the workspace; the sidebar naturally releases before the page footer.
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect.poll(async () => (await wallet.boundingBox())!.y).toBe(24);
  const balance = wallet.getByRole('group', { name: 'USDC balance', exact: true });
  await expect(balance).toBeInViewport({ ratio: 1 });
  const unitsNote = wallet.getByText(/^PreStocks balances exclude/);
  const networkNote = wallet.getByText(/^This is a provided test wallet/);
  await expect(unitsNote).toBeInViewport({ ratio: 1 });
  await expect(networkNote).toBeInViewport({ ratio: 1 });
  const unitsBox = await unitsNote.boundingBox();
  const networkBox = await networkNote.boundingBox();
  await holdings.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => holdings.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  const scrollTop = await holdings.evaluate((node) => node.scrollTop);
  const balanceBox = await balance.boundingBox();
  await page.waitForRequest('**/api/wallet?*');
  await expect.poll(() => holdings.evaluate((node) => node.scrollTop)).toBe(scrollTop);
  expect(await balance.boundingBox()).toEqual(balanceBox);
  expect(await unitsNote.boundingBox()).toEqual(unitsBox);
  expect(await networkNote.boundingBox()).toEqual(networkBox);
  await page.screenshot({ path: info.outputPath('wallet-sticky.png') });
  expect(state.unexpected).toEqual([]);
});

test('wallet adapts to short screens and lets a short list keep its natural height', async ({
  page,
}, info) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  state.wallets[d.localnet!.writer]!.accounts = [
    account(d.usdcMint, d.localnet!.writerUsdc, '10000000000'),
    account(d.assets[0]!.mint, d.assets[0]!.mint, '100000000000'),
  ];
  await page.goto('/portfolio');
  await connectWallet(page, 'Test Wallet 2');
  const wallet = page.getByRole('region', { name: 'Your wallet', exact: true });
  const holdings = wallet.getByRole('region', { name: 'PreStocks demo balances', exact: true });
  await expect(wallet).toHaveAttribute('data-bounded', 'true');
  const natural = await wallet.boundingBox();
  expect(natural!.height).toBeLessThan(800);
  expect(await holdings.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
  await page.setViewportSize({ width: 1024, height: 500 });
  await expect(wallet).toHaveAttribute('data-bounded', 'false');
  await wallet.getByRole('link', { name: 'Find protection' }).focus();
  await expect(wallet.getByRole('link', { name: 'Find protection' })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('wallet-short-viewport.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(wallet).toHaveAttribute('data-bounded', 'true');
  await expect(wallet.getByRole('group', { name: 'USDC balance', exact: true })).toBeInViewport();
  expect(state.unexpected).toEqual([]);
});

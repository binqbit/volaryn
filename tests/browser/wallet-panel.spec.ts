import { expect, test } from '@playwright/test';
import { balanceFixture } from './support/balanceFixture';
import { selectAsset } from './support/actions';

for (const width of [1440, 375, 320]) {
  test(`wallet panel is the single balance view across routes at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 900 });
    const { state, account } = await balanceFixture(page);
    const d = state.deployment;
    const funds = account(d.usdcMint, d.writerUsdc, '1234500001');
    const tokens = d.assets.map((asset) => account(asset.mint, asset.mint, '100000000000'));
    state.wallets[d.writer]!.accounts = [
      funds,
      account(d.usdcMint, d.holderUsdc, '500000000', true),
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
    await page.getByRole('button', { name: 'Connect Test Wallet 2', exact: true }).click();
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
    await page.screenshot({ path: info.outputPath('wallet-panel.png'), fullPage: true });
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
    await page.screenshot({ path: info.outputPath('wallet-token-cards.png'), fullPage: true });

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

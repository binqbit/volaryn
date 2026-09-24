import { expect, test } from '@playwright/test';
import { connectWallet, openWalletChooser } from './support/actions';
import { balanceFixture } from './support/balanceFixture';
import { injectWallet } from './support/injectedWallet';

test('the home chooser offers local wallets without navigation and restores focus when dismissed', async ({
  page,
}, info) => {
  const { state } = await balanceFixture(page);
  await page.goto('/');
  const trigger = page
    .getByRole('banner')
    .getByRole('button', { name: 'Connect wallet', exact: true });
  const initialUrl = page.url();
  const chooser = await openWalletChooser(page);
  await expect(page).toHaveURL(initialUrl);
  await expect(page.getByRole('region', { name: 'Your wallet' })).toHaveCount(0);
  await expect(
    chooser.getByRole('button', { name: 'Connect Test Wallet 1', exact: true }),
  ).toBeEnabled();
  await expect(
    chooser.getByRole('button', { name: 'Connect Test Wallet 2', exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: info.outputPath('wallet-chooser-desktop.png') });
  await chooser.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(chooser).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.setViewportSize({ width: 320, height: 844 });
  await trigger.click();
  await expect(chooser).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('wallet-chooser-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(chooser).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(initialUrl);
  expect(state.unexpected).toEqual([]);
});

test('an installed Phantom connects through Wallet Standard without signing', async ({ page }) => {
  const { state } = await balanceFixture(page);
  await injectWallet(page, { address: state.deployment.localnet!.holder });
  await page.goto('/portfolio');
  await connectWallet(page, 'Phantom');
  const wallet = page.getByRole('region', { name: 'Your wallet' });
  await expect(wallet.getByText('Phantom', { exact: true })).toBeVisible();
  await expect(wallet.getByLabel('Connected wallet address')).toHaveText(
    state.deployment.localnet!.holder,
  );
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__volarynWalletFixture.stats)).toEqual({
    connects: 1,
    completedConnects: 1,
    disconnects: 0,
    signatures: 0,
  });
  expect(state.unexpected).toEqual([]);
});

test('a rejected connection stays in the chooser and permits selecting another wallet', async ({
  page,
}) => {
  const { state } = await balanceFixture(page);
  await injectWallet(page, {
    address: state.deployment.localnet!.holder,
    rejection: 'Connection rejected in the wallet',
  });
  await page.goto('/portfolio');
  const chooser = await openWalletChooser(page);
  await chooser.getByRole('button', { name: 'Connect Phantom', exact: true }).click();
  await expect(chooser.getByRole('alert')).toContainText('Connection rejected in the wallet');
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
  await chooser.getByRole('button', { name: 'Connect Test Wallet 2', exact: true }).click();
  await expect(chooser).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Your wallet' }).getByLabel('Connected wallet address'),
  ).toHaveText(state.deployment.localnet!.writer);
  expect(await page.evaluate(() => window.__volarynWalletFixture.stats.signatures)).toBe(0);
  expect(state.unexpected).toEqual([]);
});

for (const dismissal of ['Close', 'Escape'] as const) {
  test(`a late wallet approval after ${dismissal} cannot connect or persist a session`, async ({
    page,
  }) => {
    const { state } = await balanceFixture(page);
    const deployment = state.deployment;
    const preference = `volaryn:wallet:${deployment.genesisHash}:${deployment.programId}`;
    await injectWallet(page, { address: deployment.localnet!.holder, deferred: true });
    await page.goto('/portfolio');
    const chooser = await openWalletChooser(page);
    await chooser.getByRole('button', { name: 'Connect Phantom', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.__volarynWalletFixture.stats.connects))
      .toBe(1);
    if (dismissal === 'Close')
      await chooser.getByRole('button', { name: 'Close', exact: true }).click();
    else await page.keyboard.press('Escape');
    await expect(chooser).toHaveCount(0);
    await expect(
      page.getByRole('banner').getByRole('button', { name: 'Connect wallet', exact: true }),
    ).toBeFocused();

    await page.evaluate(() => window.__volarynWalletFixture.approve());
    await expect
      .poll(() => page.evaluate(() => window.__volarynWalletFixture.stats.completedConnects))
      .toBe(1);
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Your wallet' }).getByLabel('Connected wallet address'),
    ).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), preference)).toBeNull();
    expect(await page.evaluate(() => window.__volarynWalletFixture.stats.signatures)).toBe(0);

    await page.reload();
    await expect(
      page.getByRole('banner').getByRole('button', { name: 'Connect wallet', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), preference)).toBeNull();
    expect(await page.evaluate(() => window.__volarynWalletFixture.stats.connects)).toBe(0);
    expect(state.unexpected).toEqual([]);
  });
}

test('a wallet installed after page load appears in the open chooser and can connect', async ({
  page,
}) => {
  const { state } = await balanceFixture(page);
  await injectWallet(page, {
    address: state.deployment.localnet!.holder,
    name: 'Newly installed wallet',
    registerAfterLoad: true,
  });
  await page.goto('/portfolio');
  const chooser = await openWalletChooser(page);
  const provider = chooser.getByRole('button', {
    name: 'Connect Newly installed wallet',
    exact: true,
  });
  await expect(provider).toHaveCount(0);
  await page.evaluate(() => window.__volarynWalletFixture.register());
  await expect(provider).toBeEnabled();
  await provider.click();
  await expect(chooser).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Your wallet' }).getByText('Newly installed wallet', {
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__volarynWalletFixture.stats.signatures)).toBe(0);
  expect(state.unexpected).toEqual([]);
});

for (const name of ['Phantom', 'Mainnet wallet']) {
  test(`an installed ${name} on another chain is disabled without an installation prompt`, async ({
    page,
  }) => {
    const { state } = await balanceFixture(page);
    await injectWallet(page, {
      address: state.deployment.localnet!.holder,
      name,
      chains: ['solana:mainnet'],
    });
    await page.goto('/');
    const chooser = await openWalletChooser(page);
    await expect(
      chooser.getByRole('button', { name: `Connect ${name}`, exact: true }),
    ).toBeDisabled();
    await expect(chooser.getByRole('link', { name: new RegExp(name) })).toHaveCount(0);
    await expect(
      chooser.getByRole('button', { name: 'Connect Test Wallet 1', exact: true }),
    ).toBeEnabled();
    expect(await page.evaluate(() => window.__volarynWalletFixture.stats.connects)).toBe(0);
    expect(state.unexpected).toEqual([]);
  });
}

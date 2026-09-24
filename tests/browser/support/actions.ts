import { expect, type Page } from '@playwright/test';

export async function openWalletChooser(page: Page) {
  await page
    .getByRole('banner')
    .getByRole('button', { name: 'Connect wallet', exact: true })
    .click();
  const chooser = page.getByRole('dialog', { name: 'Connect wallet', exact: true });
  await expect(chooser).toBeVisible();
  return chooser;
}

export async function connectWallet(page: Page, name = 'Test Wallet 1') {
  const chooser = await openWalletChooser(page);
  await chooser.getByRole('button', { name: `Connect ${name}`, exact: true }).click();
  await expect(chooser).toHaveCount(0);
}

export async function confirmReview(page: Page) {
  const review = page.getByRole('dialog');
  await expect(review.getByText('REVIEW BEFORE SIGNING')).toBeVisible();
  await expect(review.getByText('Estimated network fee', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Confirm and sign' }).click();
}

export async function signAction(page: Page, name: string) {
  await page.getByRole('button', { name }).click();
  await confirmReview(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Transaction status' })).toContainText(
    'Transaction finalized',
  );
}

export async function switchWallet(page: Page, role: 'holder' | 'writer') {
  // Navigation finishes before the app has loaded its manifest and restored the wallet.
  await expect(page.getByRole('region', { name: 'Your wallet' })).toBeVisible();
  const disconnect = page.getByRole('button', { name: 'Disconnect', exact: true });
  if (await disconnect.isVisible()) await disconnect.click();
  await connectWallet(page, role === 'writer' ? 'Test Wallet 2' : 'Test Wallet 1');
  await expect(
    page.getByRole('region', { name: 'Your wallet' }).getByText('Available test USDC'),
  ).toBeVisible();
}

export async function selectAsset(page: Page, symbol: string) {
  await page.getByRole('combobox', { name: 'PreStocks token' }).fill(symbol);
  await page.getByRole('option', { name: new RegExp(`^${symbol} `) }).click();
}

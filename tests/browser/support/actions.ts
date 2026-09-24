import { expect, type Page } from '@playwright/test';

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
  await page
    .getByRole('button', {
      name: role === 'writer' ? 'Connect Test Wallet 2' : 'Connect Test Wallet 1',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('region', { name: 'Your wallet' }).getByText('Available test USDC'),
  ).toBeVisible();
}

export async function selectAsset(page: Page, symbol: string) {
  await page.getByRole('combobox', { name: 'PreStocks token' }).fill(symbol);
  await page.getByRole('option', { name: new RegExp(`^${symbol} `) }).click();
}

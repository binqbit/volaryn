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
  await approveTestSignature(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Transaction status' })).toContainText(
    'Transaction finalized',
  );
}

export async function approveTestSignature(page: Page) {
  const approval = page.getByRole('dialog', { name: 'Approve test transaction', exact: true });
  await expect(approval).toHaveCount(1);
  await expect(approval.getByRole('button', { name: 'Cancel signing' })).toBeFocused();
  await approval.getByRole('button', { name: 'Sign transaction', exact: true }).click();
  await expect(approval).toHaveCount(0);
}

export async function switchWallet(page: Page, role: 'holder' | 'writer') {
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

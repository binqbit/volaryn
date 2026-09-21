import { expect, type Page } from '@playwright/test';

export async function confirmReview(page: Page) {
  const review = page.getByRole('dialog');
  await expect(review.getByText('REVIEW BEFORE SIGNING')).toBeVisible();
  await expect(review.getByText('Estimated network fee', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Confirm and sign' }).click();
}

export async function signAction(page: Page, name: string) {
  await page.getByRole('button', { name }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await confirmReview(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Transaction status' })).toContainText(
    'Transaction finalized',
  );
}

export async function switchWallet(page: Page, role: 'holder' | 'writer') {
  const disconnect = page.getByRole('button', { name: 'Disconnect', exact: true });
  if (await disconnect.isVisible()) await disconnect.click();
  await page
    .getByRole('button', {
      name: role === 'writer' ? 'Connect Local test writer' : 'Connect Local test wallet',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('region', { name: 'Your wallet' }).getByText('Available test USDC'),
  ).toBeVisible();
}

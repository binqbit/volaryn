import { expect, test, type Page } from '@playwright/test';
import { address, createSolanaRpc } from '@solana/kit';
import { fetchToken } from '@solana-program/token';
import { fetchToken as fetchAsset } from '@solana-program/token-2022';
import { AgreementStatus, fetchAgreement, protocolAddresses } from '@volaryn/protocol';
import type { Deployment } from '../../frontend/src/lib/api/client';
import { confirmReview, signAction, switchWallet } from './support/actions';

async function fillOffer(page: Page, expiry?: bigint) {
  await page.goto('/writer');
  await switchWallet(page, 'writer');
  await page.getByLabel('Gross quantity (raw-token units)', { exact: true }).fill('0.2');
  await page.getByLabel('Payout (USDC)', { exact: true }).fill('5');
  await page.getByLabel('Premium (USDC)', { exact: true }).fill('0.1');
  if (expiry) {
    const date = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString().slice(0, 19);
    await page.getByLabel('Acceptance deadline (UTC)').fill(date(expiry - 10n));
    await page.getByLabel('Protection expiry (UTC)').fill(date(expiry));
  }
}

test('writer funds and cancels offers, holder matches and exercises, writer receives assets', async ({
  page,
  request,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  const config = (await (await request.get('/api/config')).json()) as Deployment;
  const rpc = createSolanaRpc(`${baseURL}/rpc`);
  const balance = async () =>
    (await fetchToken(rpc, address(config.writerUsdc), { commitment: 'finalized' })).data.amount;
  const start = await balance();
  await fillOffer(page);
  await page.getByRole('button', { name: 'Review funded offer' }).click();
  await expect(page.getByRole('dialog')).toContainText('0.1985');
  await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review funded offer' })).toBeFocused();
  expect(await balance()).toBe(start);
  let submissions = 0;
  let approvals = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/rpc') && request.postDataJSON()?.method === 'sendTransaction')
      submissions++;
  });
  await page.getByRole('button', { name: 'Review funded offer' }).click();
  page.once('dialog', (dialog) => {
    approvals++;
    void dialog.accept();
  });
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm and sign' })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(page.getByRole('status', { name: 'Transaction status' })).toContainText(
    'Transaction finalized',
  );
  expect(approvals).toBe(1);
  expect(submissions).toBe(1);
  const cancelledAddress = address(page.url().split('/').at(-1)!);
  expect(await balance()).toBe(start - 5_000_000n);
  await signAction(page, 'Cancel offer');
  expect((await fetchAgreement(rpc, cancelledAddress)).data.status).toBe(AgreementStatus.Cancelled);
  expect(await balance()).toBe(start);
  await signAction(page, 'Recover residual funds');

  await fillOffer(page);
  await page.getByLabel('Designated holder (optional)').fill(config.holder);
  await signAction(page, 'Review funded offer');
  const agreementAddress = address(page.url().split('/').at(-1)!);
  await switchWallet(page, 'holder');
  await page.goto('/protection');
  await switchWallet(page, 'holder');
  await page.getByLabel('Exact quantity (raw-token units)').fill('0.3');
  await page.getByRole('button', { name: 'Find matching offers' }).click();
  await expect(
    page.getByText('No funded offers match these terms.', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('Exact quantity (raw-token units)').fill('0.2');
  await page.getByLabel('Minimum payout (USDC)').fill('5');
  await page.getByLabel('Maximum premium (USDC)').fill('0.1');
  await page.getByRole('button', { name: 'Find matching offers' }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
  await signAction(page, 'Activate protection');
  await switchWallet(page, 'writer');
  await expect(page.getByRole('button', { name: 'Cancel offer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reclaim expired reserve' })).toBeDisabled();
  await switchWallet(page, 'holder');
  await signAction(page, 'Exercise protection');
  const settled = (await fetchAgreement(rpc, agreementAddress)).data;
  expect(settled.status).toBe(AgreementStatus.Exercised);
  expect(settled.netReceived).toBe(198500n);
  const accounts = await protocolAddresses(settled.underlyingMint, settled.writer, settled.nonce);
  const receipt = (await fetchAsset(rpc, accounts.settlement)).data;
  expect(receipt.owner).toBe(config.writer);
  expect(receipt.amount).toBe(settled.netReceived);
  expect(await balance()).toBe(start - 5_000_000n + 100_000n);
  await switchWallet(page, 'writer');
  await page.getByText('Token accounts and balances', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your wallet' })).toContainText(
    accounts.settlement,
  );
  await page.screenshot({ path: info.outputPath('writer-receipt.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('expired protection disables delivery and returns the reserve only to its writer', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(200_000);
  const config = (await (await request.get('/api/config')).json()) as Deployment;
  const rpc = createSolanaRpc(`${baseURL}/rpc`);
  const slot = await rpc.getSlot({ commitment: 'confirmed' }).send();
  const now = await rpc.getBlockTime(slot).send();
  if (!now) throw new Error('Validator clock unavailable');
  await fillOffer(page, now + 80n);
  await signAction(page, 'Review funded offer');
  const agreementAddress = address(page.url().split('/').at(-1)!);
  await switchWallet(page, 'holder');
  await signAction(page, 'Activate protection');
  await expect(page.getByText('Expired · awaiting reclaim', { exact: true })).toBeVisible({
    timeout: 110_000,
  });
  await expect(page.getByRole('button', { name: 'Exercise protection' })).toBeDisabled();
  await switchWallet(page, 'writer');
  const before = (await fetchToken(rpc, address(config.writerUsdc))).data.amount;
  await signAction(page, 'Reclaim expired reserve');
  expect((await fetchAgreement(rpc, agreementAddress)).data.status).toBe(AgreementStatus.Expired);
  expect((await fetchToken(rpc, address(config.writerUsdc))).data.amount).toBe(before + 5_000_000n);
});

test('writer rejection submits nothing and the next wallet starts without a review', async ({
  page,
}) => {
  await fillOffer(page);
  await page.getByRole('button', { name: 'Review funded offer' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  // Reject in the wallet after the review. No offer should be created.
  let submissions = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/rpc') && request.postDataJSON()?.method === 'sendTransaction')
      submissions++;
  });
  page.once('dialog', (dialog) => dialog.dismiss());
  await confirmReview(page);
  await expect(page.getByRole('alert')).toContainText('Signature rejected');
  await switchWallet(page, 'holder');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(submissions).toBe(0);
});

test('wallet switch during fee preparation discards the previous request', async ({ page }) => {
  await fillOffer(page);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let estimating = false;
  let submissions = 0;
  await page.route('**/rpc', async (route) => {
    const method = route.request().postDataJSON()?.method;
    if (method === 'getFeeForMessage') {
      estimating = true;
      await held;
    }
    if (method === 'sendTransaction') submissions++;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Review funded offer' }).click();
  await expect.poll(() => estimating).toBe(true);
  await switchWallet(page, 'holder');
  release();
  await expect(page.getByRole('alert')).toContainText('Wallet changed while preparing');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(submissions).toBe(0);
});

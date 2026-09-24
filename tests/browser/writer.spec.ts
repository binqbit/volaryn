import { expect, test, type Page } from '@playwright/test';
import { address, createSolanaRpc } from '@solana/kit';
import { fetchToken } from '@solana-program/token';
import { fetchToken as fetchAsset } from '@solana-program/token-2022';
import { AgreementStatus, fetchAgreement, protocolAddresses } from '@volaryn/protocol';
import type { Deployment, Wallet } from '../../frontend/src/lib/api/client';
import { confirmReview, signAction, switchWallet, selectAsset } from './support/actions';

async function fillOffer(page: Page, expiry?: bigint) {
  await page.goto('/offers/new');
  await switchWallet(page, 'writer');
  await selectAsset(page, 'SPACEX');
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
  // Browser suppression of native confirmation popups must not reject an explicit approval.
  await page.addInitScript(() => {
    window.confirm = () => false;
  });
  const config = (await (await request.get('/api/config')).json()) as Deployment;
  const rpc = createSolanaRpc(`${baseURL}/rpc`);
  const balance = async () =>
    (await fetchToken(rpc, address(config.localnet!.writerUsdc), { commitment: 'finalized' })).data
      .amount;
  const start = await balance();
  await fillOffer(page);
  await page.getByRole('button', { name: 'Review funded offer' }).click();
  await expect(page.getByRole('dialog')).toContainText('0.1985');
  await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review funded offer' })).toBeFocused();
  expect(await balance()).toBe(start);
  let submissions = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/rpc') && request.postDataJSON()?.method === 'sendTransaction')
      submissions++;
  });
  await page.getByRole('button', { name: 'Review funded offer' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm and sign' })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  const approval = page.getByRole('dialog', { name: 'Approve test transaction', exact: true });
  await expect(approval).toHaveCount(1);
  await approval
    .getByRole('button', { name: 'Sign transaction', exact: true })
    .evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
  await expect(approval).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Transaction status' })).toContainText(
    'Transaction finalized',
  );
  expect(submissions).toBe(1);
  const cancelledAddress = address(page.url().split('/').at(-1)!);
  const activities = async (owner: string) =>
    (await (await request.get(`/api/activity?owner=${owner}`)).json()) as {
      items: { agreement: string; operation: string; status: string }[];
    };
  await expect
    .poll(
      async () =>
        (await activities(config.localnet!.writer)).items.find(
          (item) => item.agreement === cancelledAddress && item.operation === 'create',
        )?.status,
    )
    .toBe('finalized');
  expect(await balance()).toBe(start - 5_000_000n);
  await signAction(page, 'Cancel offer');
  expect((await fetchAgreement(rpc, cancelledAddress)).data.status).toBe(AgreementStatus.Cancelled);
  expect(await balance()).toBe(start);
  await signAction(page, 'Recover residual funds');
  await expect
    .poll(async () =>
      (await activities(config.localnet!.writer)).items
        .filter((item) => item.agreement === cancelledAddress && item.status === 'finalized')
        .map((item) => item.operation)
        .sort(),
    )
    .toEqual(['cancel', 'cleanup', 'create']);

  await fillOffer(page);
  await page.getByText('Restrict to a wallet', { exact: true }).click();
  await page.getByLabel('Designated holder (optional)').fill(config.localnet!.holder);
  await signAction(page, 'Review funded offer');
  const agreementAddress = address(page.url().split('/').at(-1)!);
  await switchWallet(page, 'holder');
  await page.goto('/offers');
  await switchWallet(page, 'holder');
  await selectAsset(page, 'SPACEX');
  await page.getByText('More filters', { exact: true }).click();
  await page.getByLabel('Exact quantity (raw-token units)').fill('0.3');
  await page.getByRole('button', { name: 'Find matching offers' }).click();
  await expect(
    page.getByText('No funded offers match these terms.', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('Exact quantity (raw-token units)').fill('0.2');
  await page.getByLabel('Minimum payout (USDC)').fill('5');
  await page.getByLabel('Maximum premium (USDC)').fill('0.1');
  await page.getByRole('button', { name: 'Find matching offers' }).click();
  await expect(page.getByRole('article', { name: /^Agreement / })).toHaveCount(1);
  await page.getByRole('link', { name: 'View offer', exact: true }).click();
  await signAction(page, 'Activate protection');
  await switchWallet(page, 'writer');
  await expect(page.getByRole('button', { name: 'Cancel offer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reclaim expired reserve' })).toBeDisabled();
  // A stale or dishonest projection cannot substitute another mint's delivery account.
  await page.route('**/api/wallet?**', async (route) => {
    const response = await route.fetch();
    const wallet = (await response.json()) as Wallet;
    const wrongSource = wallet.accounts.find(
      (account) => account.mint === config.assets.find((asset) => asset.symbol === 'OPENAI')!.mint,
    );
    const selectedMint = config.assets.find((asset) => asset.symbol === 'SPACEX')!.mint;
    await route.fulfill({
      response,
      json: {
        ...wallet,
        accounts: wallet.accounts.map((account) =>
          account.mint === selectedMint && wrongSource
            ? { ...account, address: wrongSource.address }
            : account,
        ),
      },
    });
  });
  await switchWallet(page, 'holder');
  const submittedBefore = submissions;
  await page.getByRole('button', { name: 'Exercise protection' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'The underlying account is unavailable or frozen',
  );
  expect(submissions).toBe(submittedBefore);
  await page.unroute('**/api/wallet?**');
  await switchWallet(page, 'holder');
  await signAction(page, 'Exercise protection');
  const settled = (await fetchAgreement(rpc, agreementAddress)).data;
  expect(settled.underlyingMint).toBe(
    config.assets.find((asset) => asset.symbol === 'SPACEX')!.mint,
  );
  expect(settled.underlyingDecimals).toBe(9);
  expect(settled.status).toBe(AgreementStatus.Exercised);
  await expect
    .poll(async () =>
      (await activities(config.localnet!.holder)).items
        .filter((item) => item.agreement === agreementAddress && item.status === 'finalized')
        .map((item) => item.operation)
        .sort(),
    )
    .toEqual(['activate', 'exercise']);
  expect(settled.netReceived).toBe(198500000n);
  const accounts = await protocolAddresses(settled.underlyingMint, settled.writer, settled.nonce);
  const receipt = (await fetchAsset(rpc, accounts.settlement)).data;
  expect(receipt.owner).toBe(config.localnet!.writer);
  expect(receipt.amount).toBe(settled.netReceived);
  expect(await balance()).toBe(start - 5_000_000n + 100_000n);
  await switchWallet(page, 'writer');
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
  const before = (await fetchToken(rpc, address(config.localnet!.writerUsdc))).data.amount;
  await signAction(page, 'Reclaim expired reserve');
  expect((await fetchAgreement(rpc, agreementAddress)).data.status).toBe(AgreementStatus.Expired);
  expect((await fetchToken(rpc, address(config.localnet!.writerUsdc))).data.amount).toBe(
    before + 5_000_000n,
  );
});

test('cancelling test signing by button or Escape submits nothing and permits another review', async ({
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
  const browserDialogs: string[] = [];
  page.on('dialog', async (dialog) => {
    browserDialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await confirmReview(page);
  const approval = page.getByRole('dialog', { name: 'Approve test transaction', exact: true });
  await expect(approval).toContainText('Test Wallet 2');
  await approval.getByRole('button', { name: 'Cancel signing' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Signing cancelled. No transaction was sent.',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review funded offer' })).toBeFocused();
  expect(submissions).toBe(0);

  // Escape is also an explicit cancellation, never an approval.
  await page.getByRole('button', { name: 'Review funded offer' }).click();
  await confirmReview(page);
  await expect(approval).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alert')).toContainText(
    'Signing cancelled. No transaction was sent.',
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(browserDialogs).toEqual([]);
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

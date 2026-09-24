import { expect, test } from '@playwright/test';
import { balanceFixture } from './support/balanceFixture';
import { connectWallet, selectAsset } from './support/actions';
import { paint } from './support/layout';

function gate() {
  let release = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { waiting, release };
}

test('background wallet refresh preserves layout, focus, inputs and usable controls', async ({
  page,
}) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  const fundingAccount = account(d.usdcMint, d.localnet!.writerUsdc, '100000000');
  state.wallets[d.localnet!.writer]!.accounts = [fundingAccount];
  await page.goto('/offers/new');
  await connectWallet(page, 'Test Wallet 2');
  await selectAsset(page, 'OPENAI');
  const funding = page.getByRole('group', { name: 'Funding USDC account balance' });
  const holdings = page.getByRole('group', { name: 'OPENAI holdings' });
  const form = page.getByRole('form', { name: 'Create an offer' });
  const premium = page.getByLabel('Premium (USDC)', { exact: true });
  await expect(funding).toContainText('100 USDC');
  await page.getByLabel('Payout (USDC)', { exact: true }).fill('20');
  await premium.fill('0.75');
  const text = await funding.innerText();
  const tokenText = await holdings.innerText();
  const box = await form.boundingBox();
  const pending = gate();
  state.walletDelay = pending.waiting;
  try {
    await page.waitForRequest('**/api/wallet?*');
    await paint(page);
    expect(await form.boundingBox()).toEqual(box);
    expect(await funding.innerText()).toBe(text);
    expect(await holdings.innerText()).toBe(tokenText);
    await expect(premium).toBeFocused();
    await expect(premium).toHaveValue('0.75');
    await expect(page.getByRole('button', { name: 'Use full USDC balance' })).toBeEnabled();
    fundingAccount.amountRaw = '90000000';
  } finally {
    pending.release();
  }
  await expect(funding).toContainText('90 USDC');
  await expect(funding).toContainText('70 USDC');
  expect(state.unexpected).toEqual([]);
});

test('an empty offer result stays visible during background polling and updates on success', async ({
  page,
}) => {
  const { state } = await balanceFixture(page);
  await page.goto('/offers');
  const empty = page.getByRole('heading', { name: 'No matching offers' });
  await expect(empty).toBeVisible();
  const box = await empty.boundingBox();
  const pending = gate();
  state.portfolioDelay = pending.waiting;
  try {
    await page.waitForRequest((request) => new URL(request.url()).pathname === '/api/offers');
    await paint(page);
    expect(await empty.isVisible()).toBe(true);
    expect(await empty.boundingBox()).toEqual(box);
    await expect(page.getByText('Loading agreements…')).toHaveCount(0);
    state.offers = [state.agreement];
  } finally {
    pending.release();
  }
  await expect(page.getByRole('link', { name: 'View offer' })).toBeVisible();
  await expect(empty).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});

test('a pending retry keeps the last failure visible and financial actions paused', async ({
  page,
}) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  state.wallets[d.localnet!.holder]!.accounts = [
    account(d.usdcMint, d.localnet!.holderUsdc, '1500000'),
  ];
  await page.goto(`/agreements/${state.agreement.address}`);
  await connectWallet(page, 'Test Wallet 1');
  const activate = page.getByRole('button', { name: 'Activate protection' });
  await expect(activate).toBeEnabled();
  state.walletUnavailable = true;
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('actions are paused');
  const box = await alert.boundingBox();
  const pending = gate();
  state.walletDelay = pending.waiting;
  try {
    const retry = page.waitForRequest('**/api/wallet?*');
    await page.getByRole('button', { name: 'Refresh observations' }).click();
    await retry;
    await paint(page);
    expect(await alert.isVisible()).toBe(true);
    expect(await alert.boundingBox()).toEqual(box);
    await expect(activate).toBeDisabled();
    await expect(page.getByRole('group', { name: 'USDC account balance' })).toContainText(
      'Last known',
    );
    state.walletUnavailable = false;
  } finally {
    pending.release();
  }
  await expect(alert).toHaveCount(0);
  await expect(activate).toBeEnabled();
  expect(state.unexpected).toEqual([]);
});

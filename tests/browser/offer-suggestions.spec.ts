import { expect, test, type Page } from '@playwright/test';
import { address, getBase64Decoder } from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { findPolicyPda, getAssetPolicyEncoder, VOLARYN_PROGRAM_ADDRESS } from '@volaryn/protocol';
import type { Deployment } from '../../frontend/src/lib/api/client';
import { selectAsset, switchWallet } from './support/actions';
import { documentBox, paint } from './support/layout';

const unlimited = 9_223_372_036_854_775_807n;
const utcInput = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 19);

async function openForm(page: Page) {
  await page.goto('/offers/new');
  await switchWallet(page, 'writer');
  await selectAsset(page, 'OPENAI');
  const form = page.getByRole('form', { name: 'Create an offer' });
  return form;
}

/** Override only policy observations and time; wallet and deployment reads use localnet. */
async function policyFixture(page: Page) {
  const response = await page.request.get('/api/config');
  expect(response.ok()).toBe(true);
  const deployment = (await response.json()) as Deployment;
  const policies = new Map(
    await Promise.all(
      deployment.assets.map(async (asset) => {
        const [policyAddress] = await findPolicyPda({ mint: address(asset.mint) });
        return [policyAddress as string, asset] as const;
      }),
    ),
  );
  const state = {
    now: 1_800_000_007,
    enabled: true,
    reviewedUntil: unlimited,
    maxExpiry: unlimited,
    unavailable: false,
    reads: 0,
  };
  await page.route('**/rpc', async (route) => {
    const { id, method, params } = route.request().postDataJSON() as {
      id: number;
      method: string;
      params: unknown[];
    };
    if (method === 'getBlockTime')
      return route.fulfill({ json: { jsonrpc: '2.0', id, result: state.now } });
    const asset = method === 'getAccountInfo' ? policies.get(String(params[0])) : undefined;
    if (!asset) return route.fallback();
    state.reads++;
    if (state.unavailable)
      return route.fulfill({
        json: {
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: 'Policy observation is temporarily unavailable' },
        },
      });
    const data = getBase64Decoder().decode(
      getAssetPolicyEncoder().encode({
        mint: address(asset.mint),
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        decimals: asset.decimals,
        version: 1,
        enabled: state.enabled,
        reviewedUntil: state.reviewedUntil,
        maxExpiry: state.maxExpiry,
      }),
    );
    return route.fulfill({
      json: {
        jsonrpc: '2.0',
        id,
        result: {
          context: { slot: 42 },
          value: {
            data: [data, 'base64'],
            executable: false,
            lamports: 1,
            owner: VOLARYN_PROGRAM_ADDRESS,
            rentEpoch: 0,
            space: 94,
          },
        },
      },
    });
  });
  return state;
}

test('offer templates link editable premiums and show local policy limits without a market dependency', async ({
  page,
}, info) => {
  const officialRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/assets/official')
      officialRequests.push(request.url());
  });
  const form = await openForm(page);
  const payout = form.getByLabel('Payout (USDC)', { exact: true });
  const premium = form.getByLabel('Premium (USDC)', { exact: true });
  const percentage = form.getByLabel('Premium (%)', { exact: true });
  const acceptance = form.getByLabel('Acceptance deadline (UTC)', { exact: true });
  const expiry = form.getByLabel('Protection expiry (UTC)', { exact: true });
  await expect(form.getByRole('button', { name: 'Apply suggested dates' })).toBeEnabled();
  await expect(acceptance).not.toHaveValue('');
  await expect(expiry).not.toHaveValue('');
  expect(Date.parse(`${await expiry.inputValue()}Z`)).toBeGreaterThan(
    Date.parse(`${await acceptance.inputValue()}Z`),
  );
  await expect(payout).toHaveValue('100');
  await expect(percentage).toHaveValue('10');
  await expect(premium).toHaveValue('10');
  await payout.fill('200');
  await expect(premium).toHaveValue('20');
  await payout.fill('100');
  await percentage.fill('3');
  await expect(premium).toHaveValue('3');
  await premium.fill('1.25');
  await expect(percentage).toHaveValue('1.25');
  await payout.fill('200');
  await expect(premium).toHaveValue('1.25');
  await expect(percentage).toHaveValue('0.63');
  await expect(form.getByLabel('Offer economics')).toContainText('198.75 USDC');

  const limits = form.getByRole('button', { name: 'Asset date limits', exact: true });
  const formBox = await documentBox(form);
  await limits.click();
  const tooltip = page.getByRole('dialog', { name: 'Asset date limits', exact: true });
  await expect(tooltip.getByText('No fixed date', { exact: true })).toHaveCount(2);
  await expect(tooltip).not.toContainText('Invalid Date');
  expect(await documentBox(form)).toEqual(formBox);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('offer-suggestions-mobile.png'), fullPage: true });
  await limits.click();
  await expect(tooltip).toBeInViewport({ ratio: 1 });
  expect(
    await tooltip
      .getByRole('region')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath('offer-date-limits-mobile.png') });
  expect(officialRequests).toEqual([]);
});

test('manual deadlines survive asset changes and policy polling', async ({ page }) => {
  await page.clock.install();
  const state = await policyFixture(page);
  const form = await openForm(page);
  const acceptance = form.getByLabel('Acceptance deadline (UTC)', { exact: true });
  const expiry = form.getByLabel('Protection expiry (UTC)', { exact: true });
  await expect(expiry).toHaveValue(utcInput(state.now + 7200));
  const manualAcceptance = utcInput(state.now + 900);
  const manualExpiry = utcInput(state.now + 1800);
  await acceptance.fill(manualAcceptance);
  await expiry.fill(manualExpiry);
  await selectAsset(page, 'SPACEX');
  await expect(form.getByRole('button', { name: 'Apply suggested dates' })).toBeEnabled();
  await form.getByRole('button', { name: 'Asset date limits', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Asset date limits', exact: true })).toContainText(
    'SPACEX · Local demo policy',
  );
  await page.keyboard.press('Escape');
  await expect(acceptance).toHaveValue(manualAcceptance);
  await expect(expiry).toHaveValue(manualExpiry);
  const reads = state.reads;
  state.now += 90;
  await page.clock.fastForward(31_000);
  await expect.poll(() => state.reads).toBeGreaterThan(reads);
  await paint(page);
  await expect(acceptance).toHaveValue(manualAcceptance);
  await expect(expiry).toHaveValue(manualExpiry);
});

test('changing a duration changes the proposal only until explicitly applied', async ({ page }) => {
  const state = await policyFixture(page);
  const form = await openForm(page);
  const acceptance = form.getByLabel('Acceptance deadline (UTC)', { exact: true });
  const expiry = form.getByLabel('Protection expiry (UTC)', { exact: true });
  await expect(expiry).toHaveValue(utcInput(state.now + 7200));
  await form.getByLabel('Suggested protection duration').selectOption('2592000');
  await expect(expiry).toHaveValue(utcInput(state.now + 7200));
  await form.getByRole('button', { name: 'Apply suggested dates' }).click();
  await expect(acceptance).toHaveValue(utcInput(state.now + 3600));
  await expect(expiry).toHaveValue(utcInput(state.now + 2592000));
});

test('suggested dates respect separate approval and protection limits', async ({ page }) => {
  const state = await policyFixture(page);
  state.reviewedUntil = BigInt(state.now + 1800);
  state.maxExpiry = BigInt(state.now + 3600);
  const form = await openForm(page);
  await expect(form.getByLabel('Acceptance deadline (UTC)', { exact: true })).toHaveValue(
    utcInput(state.now + 1799),
  );
  await expect(form.getByLabel('Protection expiry (UTC)', { exact: true })).toHaveValue(
    utcInput(state.now + 3600),
  );
  await expect(form.getByText('The suggested dates are shortened', { exact: false })).toBeVisible();
  await form.getByLabel('Suggested protection duration').selectOption('604800');
  await form.getByRole('button', { name: 'Apply suggested dates' }).click();
  await expect(form.getByLabel('Protection expiry (UTC)', { exact: true })).toHaveValue(
    utcInput(state.now + 3600),
  );
});

test('disabled policies explain why date suggestions are unavailable', async ({ page }) => {
  const state = await policyFixture(page);
  state.enabled = false;
  const form = await openForm(page);
  await expect(form.getByText('This asset is not enabled for new offers.')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Apply suggested dates' })).toBeDisabled();
  await expect(form.getByLabel('Acceptance deadline (UTC)', { exact: true })).toHaveValue('');
  await expect(form.getByLabel('Protection expiry (UTC)', { exact: true })).toHaveValue('');
});

test('failed policy refresh preserves entered dates and removes stale suggestions', async ({
  page,
}) => {
  await page.clock.install();
  const state = await policyFixture(page);
  const form = await openForm(page);
  const acceptance = form.getByLabel('Acceptance deadline (UTC)', { exact: true });
  const expiry = form.getByLabel('Protection expiry (UTC)', { exact: true });
  await expect(expiry).toHaveValue(utcInput(state.now + 7200));
  const manualAcceptance = utcInput(state.now + 900);
  const manualExpiry = utcInput(state.now + 1800);
  await acceptance.fill(manualAcceptance);
  await expiry.fill(manualExpiry);
  state.unavailable = true;
  await page.clock.fastForward(31_000);
  await expect(form.getByRole('button', { name: 'Retry date suggestions' })).toBeVisible();
  await expect(form.getByRole('button', { name: 'Apply suggested dates' })).toBeDisabled();
  await expect(form.getByRole('button', { name: 'Asset date limits', exact: true })).toHaveCount(0);
  await expect(acceptance).toHaveValue(manualAcceptance);
  await expect(expiry).toHaveValue(manualExpiry);
  state.unavailable = false;
  await form.getByRole('button', { name: 'Retry date suggestions' }).click();
  await expect(form.getByRole('button', { name: 'Apply suggested dates' })).toBeEnabled();
  await expect(acceptance).toHaveValue(manualAcceptance);
  await expect(expiry).toHaveValue(manualExpiry);
});

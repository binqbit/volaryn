import { confirmReview } from './support/actions';
import { expect, test } from '@playwright/test';
import { address, createSolanaRpc } from '@solana/kit';
import { fetchToken } from '@solana-program/token';
import { fetchToken as fetchToken2022 } from '@solana-program/token-2022';
import { fetchAgreement, AgreementStatus, protocolAddresses } from '@volaryn/protocol';
import recipe from '../fixtures/recipe.json' with { type: 'json' };
import type { components } from '../../frontend/src/lib/api/schema';

test('holder rejects, isolates tabs, restores after closing a tab, and exercises without the writer', async ({
  page,
  context,
  request,
  baseURL,
}, info) => {
  const config = (await (
    await request.get('/api/config')
  ).json()) as components['schemas']['Deployment'];
  const rpc = createSolanaRpc(`${baseURL}/rpc`);
  const accounts = await protocolAddresses(
    address(config.underlyingMint),
    address(config.writer),
    1n,
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', () => errors.push('Unexpected WebSocket connection'));
  let submissions = 0;
  context.on('request', (req) => {
    if (req.url().endsWith('/rpc') && req.postDataJSON()?.method === 'sendTransaction')
      submissions++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect Local test wallet' }).click();
  const activate = page.getByRole('button', { name: 'Activate protection' });
  await expect(activate).toBeEnabled();

  // The wallet can reject; the contract stays funded and no transaction is sent.
  page.once('dialog', (dialog) => dialog.dismiss());
  await activate.click();
  await confirmReview(page);
  await expect(page.getByRole('alert')).toContainText('Signature rejected');
  expect(submissions).toBe(0);
  expect((await fetchAgreement(rpc, accounts.agreement)).data.status).toBe(AgreementStatus.Funded);

  // A real browser lock prevents another tab from opening a signing flow.
  const otherTab = await context.newPage();
  await otherTab.goto('/');
  await otherTab.evaluate(async (key) => {
    await new Promise<void>((acquired) => {
      void navigator.locks.request(key, async () => {
        await new Promise<void>((release) => {
          (window as Window & { releaseJournal?: () => void }).releaseJournal = release;
          acquired();
        });
      });
    });
  }, `volaryn:pending:${config.genesisHash}:${config.programId}:${config.holder}`);
  await activate.click();
  await confirmReview(page);
  await expect(page.getByRole('alert')).toContainText('Another tab is handling this wallet');
  expect(submissions).toBe(0);
  await otherTab.evaluate(() =>
    (window as Window & { releaseJournal?: () => void }).releaseJournal?.(),
  );
  await otherTab.close();

  // A changed RPC network blocks preparation before wallet signing.
  await page.route('**/rpc', async (route) => {
    if (route.request().postDataJSON()?.method === 'getGenesisHash') {
      await route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: route.request().postDataJSON().id,
          result: '11111111111111111111111111111111',
        },
      });
    } else await route.continue();
  });
  await activate.click();
  await expect(page.getByRole('alert')).toContainText('Wrong network');
  expect(submissions).toBe(0);
  await page.unroute('**/rpc');

  // Delay status feedback so the journal is still needed when the tab closes.
  await page.route('**/rpc', async (route) => {
    if (route.request().postDataJSON()?.method === 'getSignatureStatuses') {
      await route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: route.request().postDataJSON().id,
          result: { context: { slot: 1 }, value: [null] },
        },
      });
    } else await route.continue();
  });
  const submitted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/rpc') &&
      response.request().postDataJSON()?.method === 'sendTransaction',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await activate.click();
  await confirmReview(page);
  await submitted;
  const agreementUrl = page.url();
  await page.close();
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', () => errors.push('Unexpected WebSocket connection'));
  await page.goto(agreementUrl);
  await expect(
    page.getByText('No wallet holdings are loaded before you connect.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Connect Local test wallet' }).click();
  await expect(page.getByRole('status', { name: 'Transaction status' })).toContainText(
    'Transaction finalized',
  );
  const exercise = page.getByRole('button', { name: 'Exercise protection' });
  await expect(exercise).toBeEnabled();
  expect(submissions).toBe(1);
  const active = (await fetchAgreement(rpc, accounts.agreement, { commitment: 'finalized' })).data;
  expect(active.status).toBe(AgreementStatus.Active);
  expect(
    (await fetchToken(rpc, address(config.holderUsdc), { commitment: 'finalized' })).data.amount,
  ).toBe(BigInt(recipe.holderUsdc) - BigInt(recipe.premium));
  expect(
    (await fetchToken2022(rpc, address(config.holderUnderlying), { commitment: 'finalized' })).data
      .amount,
  ).toBe(BigInt(recipe.holderUnderlying));

  page.once('dialog', (dialog) => dialog.accept());
  await exercise.click();
  await confirmReview(page);
  await expect(page.getByText('SETTLEMENT COMPLETE', { exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Transaction status' })).toContainText(
    'Transaction finalized',
  );
  expect(submissions).toBe(2);
  const settled = (await fetchAgreement(rpc, accounts.agreement, { commitment: 'finalized' })).data;
  const delivered = await fetchToken2022(rpc, accounts.settlement, { commitment: 'finalized' });
  expect(settled.status).toBe(AgreementStatus.Exercised);
  expect(delivered.data.owner).toBe(config.writer);
  expect(delivered.data.amount).toBe(settled.netReceived);
  expect(settled.netReceived).toBe(992500n);
  expect(
    (await fetchToken(rpc, address(config.holderUsdc), { commitment: 'finalized' })).data.amount,
  ).toBe(BigInt(recipe.holderUsdc) - BigInt(recipe.premium) + BigInt(recipe.payout));
  expect(
    (await fetchToken(rpc, address(config.writerUsdc), { commitment: 'finalized' })).data.amount,
  ).toBe(BigInt(recipe.writerBalance) - BigInt(recipe.payout) + BigInt(recipe.premium));
  expect((await fetchToken(rpc, accounts.reserve, { commitment: 'finalized' })).data.amount).toBe(
    0n,
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('settled.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
});

test('same-origin transport preserves RPC errors and static-route boundaries', async ({
  request,
}) => {
  const denied = await request.post('/rpc', {
    data: { jsonrpc: '2.0', id: 41, method: 'requestAirdrop', params: [] },
  });
  expect((await denied.json()).error.code).toBe(-32601);
  expect((await request.get('/api/missing')).status()).toBe(404);
  expect((await request.get('/assets/missing.js')).status()).toBe(404);
  expect((await request.get('/agreements/example')).headers()['content-type']).toContain(
    'text/html',
  );
  expect((await request.get('/api/config')).headers()['cache-control']).toBe('no-store');
});

test('a fixture wallet cannot open a deployment naming a different holder', async ({ page }) => {
  await page.route('**/api/config', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as components['schemas']['Deployment'];
    await route.fulfill({ response, json: { ...config, holder: config.writer } });
  });
  let submissions = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/rpc') && request.postDataJSON()?.method === 'sendTransaction')
      submissions++;
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Demo identity does not match the ledger');
  await expect(page.getByRole('button', { name: 'Activate protection' })).toHaveCount(0);
  expect(submissions).toBe(0);
});

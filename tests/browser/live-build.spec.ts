import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { address, getBase64Decoder } from '@solana/kit';
import { TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { findPolicyPda, getAssetPolicyEncoder, VOLARYN_PROGRAM_ADDRESS } from '@volaryn/protocol';
import type { Deployment } from '../../frontend/src/lib/api/client';
import { openWalletChooser, selectAsset } from './support/actions';
import { injectWallet } from './support/injectedWallet';

test('the production artifact opens a mainnet deployment without local wallets or test labels', async ({
  page,
}, info) => {
  const registry = JSON.parse(await readFile('config/assets.json', 'utf8'));
  const deployment: Deployment = {
    schemaVersion: 3,
    mode: 'mainnet',
    genesisHash: registry.genesisHash,
    programId: VOLARYN_PROGRAM_ADDRESS,
    programSha256: 'a'.repeat(64),
    programLength: 1,
    authority: '11111111111111111111111111111111',
    upgradeAuthority: null,
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    assets: registry.assets.map((asset: Deployment['assets'][number]) => ({
      ...asset,
      referenceMint: asset.mint,
    })),
  };
  const failures: string[] = [];
  const policyReads: string[] = [];
  const chainNow = 1_800_000_007;
  const asset = deployment.assets[0]!;
  const [policyAddress] = await findPolicyPda({ mint: address(asset.mint) });
  const policyData = getBase64Decoder().decode(
    getAssetPolicyEncoder().encode({
      mint: address(asset.mint),
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      decimals: asset.decimals,
      version: 1,
      enabled: true,
      reviewedUntil: BigInt(chainNow + 60 * 86400),
      maxExpiry: BigInt(chainNow + 60 * 86400),
    }),
  );
  const utcInput = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 19);
  await injectWallet(page, {
    address: deployment.authority,
    chains: ['solana:mainnet'],
    registerAfterLoad: true,
  });
  page.on('pageerror', (error) => failures.push(error.message));
  // Serve the actual production output; all API responses are controlled, with no network access.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:8080') {
      failures.push(`Unexpected external request: ${url.origin}`);
      return route.abort();
    }
    const path = url.pathname;
    if (path === '/api/config') return route.fulfill({ json: deployment });
    if (path === '/api/offers') return route.fulfill({ json: [] });
    if (path === '/api/wallet')
      return route.fulfill({ json: { owner: deployment.authority, accounts: [] } });
    if (path === '/api/activity')
      return route.fulfill({ json: { items: [], pending: [], indexedAgreements: [], next: null } });
    if (path === '/rpc') {
      const request = route.request().postDataJSON();
      if (request.method === 'getAccountInfo') {
        expect(request.params[0]).toBe(policyAddress);
        policyReads.push(request.params[0]);
        return route.fulfill({
          json: {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              context: { slot: 1 },
              value: {
                data: [policyData, 'base64'],
                executable: false,
                lamports: 1,
                owner: VOLARYN_PROGRAM_ADDRESS,
                rentEpoch: 0,
                space: 94,
              },
            },
          },
        });
      }
      const readResults: Record<string, string | number> = {
        getGenesisHash: deployment.genesisHash,
        getSlot: 1,
        getBlockTime: chainNow,
      };
      expect(Object.hasOwn(readResults, request.method)).toBe(true);
      return route.fulfill({
        json: { jsonrpc: '2.0', id: request.id, result: readResults[request.method] },
      });
    }
    if (path.startsWith('/assets/'))
      return route.fulfill({
        body: await readFile(`frontend/dist-live${path}`),
        contentType: path.endsWith('.css') ? 'text/css' : 'application/javascript',
      });
    if (['/', '/offers', '/offers/new', '/portfolio/activity'].includes(path))
      return route.fulfill({
        body: await readFile('frontend/dist-live/index.html'),
        contentType: 'text/html',
      });
    failures.push(`Unexpected request: ${path}`);
    return route.abort();
  });
  await page.goto('http://127.0.0.1:8080/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Set a price floor');
  const chooser = await openWalletChooser(page);
  await expect(page).toHaveURL('http://127.0.0.1:8080/');
  await expect(chooser.getByRole('button', { name: /Test Wallet/ })).toHaveCount(0);
  await expect(chooser.getByRole('link', { name: /Phantom/ })).toHaveAttribute(
    'href',
    'https://phantom.com/download',
  );
  await expect(page.locator('body')).not.toContainText('LOCALNET DEMO');
  await page.keyboard.press('Escape');
  await expect(chooser).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Create offer', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Connect a wallet to create an offer' }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('live-create.png'), fullPage: true });
  await page.getByRole('button', { name: 'Choose a wallet', exact: true }).click();
  await page.evaluate(() => window.__volarynWalletFixture.register());
  await chooser.getByRole('button', { name: 'Connect Phantom', exact: true }).click();
  await expect(chooser).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Your wallet' }).getByText('Phantom', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your wallet' })).toContainText('Available USDC');
  await expect(page.locator('body')).not.toContainText('test USDC');

  const form = page.getByRole('form', { name: 'Create an offer' });
  await expect(form.getByLabel('Payout (USDC)', { exact: true })).toHaveValue('100');
  await expect(form.getByLabel('Premium (USDC)', { exact: true })).toHaveValue('10');
  await expect(form.getByLabel('Premium (%)', { exact: true })).toHaveValue('10');
  const duration = form.getByLabel('Suggested protection duration');
  await expect(duration).toHaveValue('604800');
  await selectAsset(page, asset.symbol);
  const acceptance = form.getByLabel('Acceptance deadline (UTC)', { exact: true });
  const expiry = form.getByLabel('Protection expiry (UTC)', { exact: true });
  await expect(expiry).toHaveValue(utcInput(chainNow + 604800));
  await expect(acceptance).toHaveValue(utcInput(chainNow + 86400));
  expect(policyReads).toContain(policyAddress);

  await duration.selectOption('7200');
  await expect(expiry).toHaveValue(utcInput(chainNow + 604800));
  await form.getByRole('button', { name: 'Apply suggested dates', exact: true }).click();
  await expect(expiry).toHaveValue(utcInput(chainNow + 7200));
  await expect(acceptance).toHaveValue(utcInput(chainNow + 3600));
  await expect(form.getByLabel('Payout (USDC)', { exact: true })).toHaveValue('100');

  await form.getByRole('button', { name: 'How amounts are calculated', exact: true }).click();
  const explanation = page.getByRole('dialog', { name: 'How amounts are calculated', exact: true });
  await expect(explanation).toBeVisible();
  await expect(explanation).toContainText('They are not used to set these amounts');
  await expect(explanation).not.toContainText('test USDC');
  await expect(explanation).not.toContainText('demonstration amount');
  await expect(explanation).not.toContainText('replica');
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toContainText('LOCALNET DEMO');
  await expect(page.locator('body')).not.toContainText('test USDC');
  await page.screenshot({ path: info.outputPath('live-offer-suggestions.png'), fullPage: true });
  expect(await page.evaluate(() => window.__volarynWalletFixture.stats.signatures)).toBe(0);
  expect(failures).toEqual([]);
});

import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { VOLARYN_PROGRAM_ADDRESS } from '@volaryn/protocol';
import type { Deployment } from '../../frontend/src/lib/api/client';
import { openWalletChooser } from './support/actions';
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
  await injectWallet(page, {
    address: deployment.authority,
    chains: ['solana:mainnet'],
    registerAfterLoad: true,
  });
  page.on('pageerror', (error) => failures.push(error.message));
  // Serve the actual production output; all API responses are controlled, with no network access.
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/config') return route.fulfill({ json: deployment });
    if (path === '/api/offers') return route.fulfill({ json: [] });
    if (path === '/api/wallet')
      return route.fulfill({ json: { owner: deployment.authority, accounts: [] } });
    if (path === '/api/activity')
      return route.fulfill({ json: { items: [], pending: [], indexedAgreements: [], next: null } });
    if (path === '/rpc') {
      const request = route.request().postDataJSON();
      const readResults: Record<string, string | number> = {
        getGenesisHash: deployment.genesisHash,
        getSlot: 1,
        getBlockTime: Math.floor(Date.now() / 1000),
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
  expect(await page.evaluate(() => window.__volarynWalletFixture.stats.signatures)).toBe(0);
  expect(failures).toEqual([]);
});

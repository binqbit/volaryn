import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { VOLARYN_PROGRAM_ADDRESS } from '@volaryn/protocol';
import type { Deployment } from '../../frontend/src/lib/api/client';

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
  page.on('pageerror', (error) => failures.push(error.message));
  // Serve the actual production output; all API responses are controlled, with no network access.
  await page.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/config') return route.fulfill({ json: deployment });
    if (path === '/api/offers') return route.fulfill({ json: [] });
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
  await page.getByRole('link', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your wallet' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Test Wallet/ })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('LOCALNET DEMO');
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Create offer', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Connect a wallet to create an offer' }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('live-create.png'), fullPage: true });
  expect(failures).toEqual([]);
});

import { expect, test } from '@playwright/test';
import { address, createSolanaRpc } from '@solana/kit';
import type { Deployment, Wallet } from '../../frontend/src/lib/api/client';
import { connectWallet, selectAsset } from './support/actions';

test('issuer scaling is distinguished from unscaled input and the exact reviewed obligation', async ({
  page,
  request,
  baseURL,
}) => {
  const deployment = (await (await request.get('/api/config')).json()) as Deployment;
  const asset = deployment.assets.find((item) => item.symbol === 'ANTHROPIC')!;
  const wallet = (await (
    await request.get(`/api/wallet?owner=${deployment.localnet!.writer}`)
  ).json()) as Wallet;
  const account = wallet.accounts.find((item) => item.mint === asset.mint)!;
  const rpc = createSolanaRpc(`${baseURL}/rpc`);
  const { value: observed } = await rpc
    .getAccountInfo(address(account.address), { encoding: 'jsonParsed', commitment: 'finalized' })
    .send();
  const balance = (
    observed?.data as {
      parsed: { info: { tokenAmount: { amount: string; uiAmountString: string } } };
    }
  ).parsed.info.tokenAmount;
  // The actual token program/RPC displays the fixture's multiplier of two.
  expect(balance.amount).toBe(account.amountRaw);
  expect(balance.amount).toBe('100000000000');
  expect(balance.uiAmountString).toBe('200');

  let submissions = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/rpc') && request.postDataJSON()?.method === 'sendTransaction')
      submissions++;
  });
  await page.goto('/offers/new');
  await connectWallet(page, 'Test Wallet 2');
  await selectAsset(page, asset.symbol);
  const holding = page.getByRole('article', { name: 'ANTHROPIC wallet balance' });
  await expect(holding.locator('strong').first()).toHaveText('100');
  await expect(holding).toContainText('Unscaled tokens');
  await expect(page.getByRole('form', { name: 'Create an offer' })).toContainText(
    'Your external wallet may show a different scaled balance.',
  );
  await page.getByLabel('Gross quantity (unscaled tokens)', { exact: true }).fill('0.25');
  await page.getByRole('button', { name: 'Review funded offer' }).click();
  const review = page.getByRole('dialog');
  await expect(review).toContainText('0.25 unscaled tokens');
  await expect(review).toContainText('250000000 base units');
  await expect(review).toContainText("may differ from your external wallet's display");
  await review.getByText('Token identity', { exact: true }).click();
  const context = review.getByRole('link', { name: 'Verified issuer context' });
  await expect(context).toHaveAttribute('href', `/issuer-assets?q=${asset.referenceMint}`);
  await expect(context).toHaveAttribute('target', '_blank');
  await expect(context).toHaveAttribute('rel', 'noopener noreferrer');
  await review.getByRole('button', { name: 'Back', exact: true }).click();
  expect(submissions).toBe(0);
});

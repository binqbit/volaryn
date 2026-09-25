import { expect, test } from '@playwright/test';
import { connectWallet } from './support/actions';
import { balanceFixture } from './support/balanceFixture';
import { journalKey } from '../../frontend/src/features/journal';
import type { PendingTransaction } from '../../frontend/src/features/pending';

for (const view of ['agreement', 'portfolio', 'offers'] as const) {
  test(`finalization refreshes ${view}, wallet and activity once without waiting for polling`, async ({
    page,
  }) => {
    const { state, account } = await balanceFixture(page);
    const d = state.deployment;
    const owner = d.localnet!.holder;
    const usdc = account(d.usdcMint, d.localnet!.holderUsdc, '100000000');
    state.wallets[owner]!.accounts = [usdc];
    const pending: PendingTransaction = {
      signature: '1'.repeat(64),
      lastValidBlockHeight: '1000',
      owner,
      side: 'writer',
      actorRole: 'holder',
      operation: 'activate',
      agreement: state.agreement.address,
    };
    await page.addInitScript(
      ({ key, pending }) => localStorage.setItem(key, JSON.stringify(pending)),
      { key: journalKey(d.genesisHash, d.programId, owner), pending },
    );
    let finalized = false;
    const reads = { agreement: 0, portfolio: 0, offers: 0, wallet: 0, activity: 0 };
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const agreement = finalized
        ? { ...state.agreement, status: 'active', holder: owner }
        : state.agreement;
      if (url.pathname.startsWith('/api/agreements/')) {
        reads.agreement++;
        return route.fulfill({ json: agreement });
      }
      if (url.pathname === '/api/agreements') {
        reads.portfolio++;
        return route.fulfill({ json: finalized ? [agreement] : [] });
      }
      if (url.pathname === '/api/offers') {
        reads.offers++;
        return route.fulfill({ json: finalized ? [] : [agreement] });
      }
      if (url.pathname === '/api/wallet') reads.wallet++;
      if (url.pathname === '/api/activity') reads.activity++;
      await route.fallback();
    });
    await page.route('**/rpc', async (route) => {
      const { method, id } = route.request().postDataJSON();
      if (method === 'getSignatureStatuses')
        return route.fulfill({
          json: {
            jsonrpc: '2.0',
            id,
            result: {
              context: { slot: 42 },
              value: [
                {
                  slot: 42,
                  err: null,
                  confirmationStatus: finalized ? 'finalized' : 'confirmed',
                  confirmations: finalized ? null : 1,
                },
              ],
            },
          },
        });
      await route.fallback();
    });

    await page.clock.install();
    await page.goto(view === 'agreement' ? `/agreements/${state.agreement.address}` : `/${view}`);
    await connectWallet(page, 'Test Wallet 1');
    const status = page.getByRole('status', { name: 'Transaction status' });
    await expect(status).toContainText('Confirmed on chain · waiting for finality');
    const balance = page.getByRole('region', { name: 'Your wallet' });
    await expect(balance.getByText('100', { exact: true })).toBeVisible();
    // Freeze periodic timers after the initial confirmed observation. Advancing
    // one second permits signature polling, but not the three-second list poll.
    await page.clock.pauseAt(new Date(Date.now() + 100));
    const before = { ...reads };
    finalized = true;
    usdc.amountRaw = '99500000';
    await page.clock.runFor(1000);
    await expect(status).toContainText('Transaction finalized', { timeout: 2000 });
    await expect(balance.getByText('99.5', { exact: true })).toBeVisible({ timeout: 1000 });
    if (view === 'agreement')
      await expect(page.getByRole('status', { name: 'Agreement outcome' })).toContainText(
        'Your protection is active',
        { timeout: 1000 },
      );
    else if (view === 'portfolio')
      await expect(page.getByRole('link', { name: 'View agreement', exact: true })).toBeVisible({
        timeout: 1000,
      });
    else
      await expect(page.getByRole('heading', { name: 'No matching offers' })).toBeVisible({
        timeout: 1000,
      });
    expect(reads[view] - before[view]).toBe(1);
    expect(reads.wallet - before.wallet).toBe(1);
    expect(reads.activity - before.activity).toBe(1);

    // No signature-completion loop or ordinary rerender may cause another fetch.
    await page.clock.runFor(1000);
    expect(reads[view] - before[view]).toBe(1);
    expect(reads.wallet - before.wallet).toBe(1);
    expect(reads.activity - before.activity).toBe(1);
    expect(state.unexpected).toEqual([]);
  });
}

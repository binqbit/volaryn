import { expect, test } from '@playwright/test';
import { balanceFixture } from './support/balanceFixture';
import { selectAsset, switchWallet } from './support/actions';

test('the writer can manage an offer but only another wallet can activate it', async ({ page }) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  for (const role of ['writer', 'holder'] as const) {
    state.wallets[d.localnet![role]]!.accounts = [
      account(d.usdcMint, d.localnet![`${role}Usdc`], '100000000'),
    ];
  }
  await page.goto(`/agreements/${state.agreement.address}`);
  await switchWallet(page, 'writer');
  await expect(page.getByLabel('Your agreement role')).toHaveText(
    'Your role: writer · capital provider',
  );
  await expect(page.getByRole('status', { name: 'Agreement outcome' })).toHaveText(
    'Your offer is awaiting a holder',
  );
  await expect(page.getByRole('button', { name: /Activate/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel offer' })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Cancel offer' })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Activate/ })).toHaveCount(0);
  await switchWallet(page, 'holder');
  await expect(
    page.getByRole('button', { name: 'Activate protection', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Cancel offer' })).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});

test('own offers leave discovery on connection and remain in the writer portfolio', async ({
  page,
}) => {
  const { state } = await balanceFixture(page);
  const d = state.deployment;
  const own = state.agreement;
  const other = { ...own, address: d.authority, writer: d.localnet!.holder };
  // Deliberately return both records from discovery to exercise the UI's defensive filter.
  state.offers = [own, other];
  await page.route('**/api/agreements?*', (route) => {
    const writer = new URL(route.request().url()).searchParams.get('writer');
    return route.fulfill({ json: state.offers.filter((offer) => offer.writer === writer) });
  });
  await page.goto('/offers');
  const ownCard = page.getByRole('article', { name: `Agreement ${own.address}`, exact: true });
  const otherCard = page.getByRole('article', { name: `Agreement ${other.address}`, exact: true });
  await expect(ownCard).toBeVisible();
  await expect(otherCard).toBeVisible();
  const discovery = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === '/api/offers' && url.searchParams.get('eligible_holder') === own.writer;
  });
  await switchWallet(page, 'writer');
  await discovery;
  await expect(ownCard).toHaveCount(0);
  await expect(otherCard).toBeVisible();
  await page
    .getByText('Your own offers are in', { exact: false })
    .getByRole('link', { name: 'My offers' })
    .click();
  await expect(ownCard).toBeVisible();
  await expect(otherCard).toHaveCount(0);
  await page.goto('/offers');
  await expect(otherCard).toBeVisible();
  await expect(ownCard).toHaveCount(0);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(ownCard).toBeVisible();
  expect(state.unexpected).toEqual([]);
});

test('self-designation is explained before review or signing, even when the field is collapsed', async ({
  page,
}) => {
  const { state, account } = await balanceFixture(page);
  const d = state.deployment;
  state.wallets[d.localnet!.writer]!.accounts = [
    account(d.usdcMint, d.localnet!.writerUsdc, '100000000'),
  ];
  await page.goto('/offers/new');
  await switchWallet(page, 'writer');
  await selectAsset(page, 'OPENAI');
  const form = page.getByRole('form', { name: 'Create an offer' });
  const restriction = form.locator('summary').filter({ hasText: 'Restrict to a wallet' });
  const designated = form.getByLabel('Designated holder (optional)');
  await restriction.click();
  await designated.fill(` ${d.localnet!.writer} `);
  await restriction.click();
  await form.getByRole('button', { name: 'Review funded offer' }).click();
  await expect(form.getByRole('alert')).toHaveText(
    'The designated holder must be a different wallet from the writer.',
  );
  await expect(designated).toBeVisible();
  await expect(designated).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});

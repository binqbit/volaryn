import { selectAsset } from './support/actions';
import { expect, test } from '@playwright/test';
import type { Agreement, Deployment } from '../../frontend/src/lib/api/client';

test('home explains the product and gives clear entry points without loading offers or holdings', async ({
  page,
}, info) => {
  const discoveries: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (['/api/offers', '/api/agreements', '/api/wallet', '/api/assets/official'].includes(path))
      discoveries.push(path);
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Set a price floor');
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Your wallet' })).toHaveCount(0);
  expect(discoveries).toEqual([]);
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.screenshot({ path: info.outputPath('home-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('home-mobile.png'), fullPage: true });
  await page.getByRole('link', { name: 'Create an offer', exact: false }).click();
  await expect(page).toHaveURL(/\/offers\/new$/);
  await expect(
    page.getByRole('heading', { name: 'Connect a wallet to create an offer' }),
  ).toBeVisible();
  await expect(page.getByRole('form', { name: 'Create an offer' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Choose a wallet', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Your wallet' })).toBeInViewport();
  await navigation.getByRole('link', { name: 'My portfolio', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your portfolio starts with your wallet' }),
  ).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('offer cards lead to full terms and portfolio lists remain wallet scoped', async ({
  page,
  request,
}, info) => {
  const config = (await (await request.get('/api/config')).json()) as Deployment;
  const [original] = (await (await request.get('/api/agreements')).json()) as Agreement[];
  if (!original) throw new Error('Missing fixture agreement');
  const offer: Agreement = {
    ...original,
    status: 'funded',
    holder: null,
    designatedHolder: null,
    acceptBefore: '4102444700',
    expiresAt: '4102444800',
  };
  const portfolioQueries: URL[] = [];
  let submissions = 0;
  await page.route('**/api/offers**', (route) =>
    route.fulfill({
      json: [
        offer,
        {
          ...offer,
          address: config.authority,
          payout: '30000000',
          premium: '1000000',
          quantityRaw: '2000000000',
        },
      ],
    }),
  );
  await page.route('**/api/agreements**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/agreements') {
      portfolioQueries.push(url);
      return route.fulfill({
        json:
          url.searchParams.has('holder') || url.searchParams.has('owner')
            ? [{ ...offer, status: 'exercised', holder: config.localnet!.holder }]
            : [],
      });
    }
    return route.fulfill({ json: offer });
  });
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === '/rpc' &&
      request.postDataJSON()?.method === 'sendTransaction'
    )
      submissions++;
  });
  await page.goto('/offers');
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Activate protection' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Explore offers');
  await page.screenshot({ path: info.outputPath('offers-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('offers-mobile.png'), fullPage: true });
  await page.getByRole('link', { name: 'View offer', exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/agreements/${original.address}$`));
  await expect(page.getByRole('heading', { name: 'Agreement details' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate protection' })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Agreement details' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect Test Wallet 1', exact: true }).click();
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await navigation.getByRole('link', { name: 'My portfolio', exact: true }).click();
  await expect(page.getByRole('article', { name: /^Agreement / })).toHaveCount(1);
  await expect(page.getByRole('article', { name: /^Agreement / })).toContainText('Exercised');
  expect(portfolioQueries.at(-1)?.searchParams.get('owner')).toBe(config.localnet!.holder);
  expect(portfolioQueries.at(-1)?.searchParams.has('status')).toBe(false);
  await page
    .getByRole('navigation', { name: 'Portfolio views' })
    .getByRole('link', { name: 'My offers', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'No offers created yet' })).toBeVisible();
  expect(portfolioQueries.at(-1)?.searchParams.get('writer')).toBe(config.localnet!.holder);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Your portfolio starts with your wallet' }),
  ).toBeVisible();
  await navigation.getByRole('link', { name: 'Create offer', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Test Wallet 2', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Create an offer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review funded offer' })).toBeDisabled();
  await selectAsset(page, 'OPENAI');
  await expect(page.getByRole('button', { name: 'Review funded offer' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('create-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: info.outputPath('create-desktop.png'), fullPage: true });
  expect(submissions).toBe(0);
});

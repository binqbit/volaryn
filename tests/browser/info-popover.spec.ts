import { expect, test, type Locator } from '@playwright/test';
import { balanceFixture } from './support/balanceFixture';
import { officialCatalog } from './support/officialCatalog';
import { documentBox, paint } from './support/layout';
import { selectAsset } from './support/actions';

async function expectAnchored(trigger: Locator, tooltip: Locator) {
  await expect(tooltip).toBeInViewport({ ratio: 1 });
  await expect
    .poll(async () => {
      const anchor = (await trigger.boundingBox())!;
      const popup = (await tooltip.boundingBox())!;
      const side = await tooltip.getAttribute('data-side');
      const gap =
        side === 'top' ? anchor.y - popup.y - popup.height : popup.y - anchor.y - anchor.height;
      return Math.abs(gap - 10) < 2;
    })
    .toBe(true);
  const anchor = (await trigger.boundingBox())!;
  const popup = (await tooltip.boundingBox())!;
  expect(popup.width).toBeLessThanOrEqual(352);
  expect(popup.height).toBeLessThanOrEqual(352);
  const arrow = (await tooltip.locator('span[aria-hidden="true"]').first().boundingBox())!;
  expect(arrow.x + arrow.width / 2).toBeGreaterThanOrEqual(anchor.x);
  expect(arrow.x + arrow.width / 2).toBeLessThanOrEqual(anchor.x + anchor.width);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(
    await tooltip
      .getByRole('region')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  expect(
    await tooltip.evaluate((element) => ({
      modal: element.matches(':modal'),
      backdrop: getComputedStyle(element, '::backdrop').backgroundColor,
      scrollLocked: getComputedStyle(document.documentElement).overflow === 'hidden',
    })),
  ).toEqual({ modal: false, backdrop: 'rgba(0, 0, 0, 0)', scrollLocked: false });
}

for (const width of [1440, 375, 320]) {
  test(`information tooltips stay beside their triggers without changing the grid at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 640 : 900 });
    const { state } = await balanceFixture(page);
    await page.route('**/api/assets/official', (route) =>
      route.fulfill({ json: officialCatalog() }),
    );
    await page.goto('/issuer-assets');
    const cards = page.getByRole('article', { includeHidden: true });
    await expect(cards).toHaveCount(8);
    const card = page.getByRole('article', { name: 'SPACEX official asset', exact: true });
    const details = card.getByRole('button', { name: /^Asset details/ });
    const before = await Promise.all((await cards.all()).map(documentBox));
    await details.focus();
    await details.press('Enter');
    const dialog = page.getByRole('dialog', {
      name: 'SpaceX PreStocks Asset details',
      exact: true,
    });
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    await expect(details).toBeFocused();
    await expectAnchored(details, dialog);
    expect(await Promise.all((await cards.all()).map(documentBox))).toEqual(before);
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath('asset-tooltip.png') });
    const sourceValue = dialog.getByText('120.6869953806347', { exact: true });
    await expect(sourceValue).toBeVisible();
    await sourceValue.click();
    await expect(dialog).toBeVisible();
    const lastLine = dialog.getByText('Review valid until', { exact: true });
    const content = dialog.getByRole('region', { name: 'Asset details content', exact: true });
    await content.focus();
    await content.press('End');
    await expect(lastLine).toBeInViewport({ ratio: 1 });
    await expect(close).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath('asset-details.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(details).toBeFocused();
    expect(await Promise.all((await cards.all()).map(documentBox))).toEqual(before);

    const behaviorTrigger = card.getByRole('button', {
      name: 'Verified token behavior',
      exact: true,
    });
    await behaviorTrigger.click();
    const behavior = page.getByRole('dialog', {
      name: 'SpaceX PreStocks Verified token behavior',
      exact: true,
    });
    await expect(behavior).toContainText('The issuer can freeze token accounts and block delivery');
    await expectAnchored(behaviorTrigger, behavior);
    await page.screenshot({ path: info.outputPath('token-behavior.png') });
    const behaviorContent = behavior.getByRole('region');
    await behaviorContent.focus();
    await behaviorContent.press('End');
    await expect(behavior.getByRole('listitem').last()).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath('token-extensions.png') });
    await page.mouse.click(2, 2);
    await expect(behavior).not.toBeVisible();
    await expect(behaviorTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(await Promise.all((await cards.all()).map(documentBox))).toEqual(before);

    const catalogHeading = page.getByRole('heading', { name: 'Official assets', exact: true });
    const headingBefore = await documentBox(catalogHeading);
    for (const title of [
      'Test tokens · no real funds',
      'Transfer rules & token units',
      'Data sources & methodology',
    ]) {
      const trigger = page.getByRole('button', {
        name: title,
        exact: title !== 'Data sources & methodology',
      });
      await trigger.click();
      const information = page.getByRole('dialog', { name: title, exact: true });
      await expectAnchored(trigger, information);
      await page.screenshot({
        path: info.outputPath(`${title.split(' ')[0]!.toLowerCase()}-tooltip.png`),
      });
      await information.getByRole('button', { name: 'Close', exact: true }).click();
      expect(await documentBox(catalogHeading)).toEqual(headingBefore);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(state.unexpected).toEqual([]);
  });
}

test('token identity opens without moving form fields and navigates without leaving an overlay behind', async ({
  page,
}) => {
  const { state } = await balanceFixture(page);
  await page.route('**/api/assets/official', (route) => route.fulfill({ json: officialCatalog() }));
  await page.goto('/offers/new');
  await page.getByRole('button', { name: 'Connect Test Wallet 2', exact: true }).click();
  await selectAsset(page, 'OPENAI');
  const form = page.getByRole('form', { name: 'Create an offer' });
  const premium = form.getByLabel('Premium (USDC)', { exact: true });
  await premium.fill('0.75');
  const before = await documentBox(form);
  await form.getByRole('button', { name: 'Token identity', exact: true }).click();
  const identity = page.getByRole('dialog', {
    name: 'OpenAI PreStocks Token identity',
    exact: true,
  });
  await expect(identity).toContainText('Referenced PreStocks mint (mainnet)');
  expect(
    await documentBox(page.getByRole('form', { name: 'Create an offer', includeHidden: true })),
  ).toEqual(before);
  // The page stays interactive: an outside input receives the first click.
  await premium.click();
  await premium.fill('0.8');
  await expect(identity).not.toBeVisible();
  await expect(premium).toHaveValue('0.8');
  await form.getByRole('button', { name: 'Token identity', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Verified issuer context' }).click();
  await expect(page).toHaveURL(/\/issuer-assets\?q=/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe(
    'hidden',
  );
  expect(state.unexpected).toEqual([]);
});

test('tooltips follow scroll and resize, flip at edges, toggle, and dismiss when their trigger leaves view', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await balanceFixture(page);
  await page.route('**/api/assets/official', (route) => route.fulfill({ json: officialCatalog() }));
  await page.goto('/issuer-assets');
  const card = page.getByRole('article', { name: 'ANDURIL official asset', exact: true });
  const trigger = card.getByRole('button', { name: /^Asset details/ });
  const tooltip = page.getByRole('dialog', {
    name: 'Anduril PreStocks Asset details',
    exact: true,
  });
  await trigger.evaluate((element) =>
    window.scrollTo(0, element.getBoundingClientRect().top + scrollY - innerHeight + 70),
  );
  await trigger.click();
  await expectAnchored(trigger, tooltip);
  await expect(tooltip).toHaveAttribute('data-side', 'top');
  await trigger.evaluate((element) =>
    window.scrollTo(0, element.getBoundingClientRect().top + scrollY - 120),
  );
  await expect(tooltip).toHaveAttribute('data-side', 'bottom');
  await expectAnchored(trigger, tooltip);
  await page.setViewportSize({ width: 1100, height: 900 });
  await expectAnchored(trigger, tooltip);
  await page.screenshot({ path: info.outputPath('anchored-after-resize.png') });
  await trigger.click();
  await expect(tooltip).not.toBeVisible();
  await trigger.click();
  await expectAnchored(trigger, tooltip);
  // A different trigger closes the old tooltip and opens its own in one click.
  const other = page
    .getByRole('article', { name: 'ANTHROPIC official asset', exact: true })
    .getByRole('button', { name: /^Asset details/ });
  await other.click();
  await expect(tooltip).not.toBeVisible();
  const second = page.getByRole('dialog', {
    name: 'Anthropic PreStocks Asset details',
    exact: true,
  });
  await expectAnchored(other, second);
  await expect(page.locator('[popover]:popover-open')).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await paint(page);
  await expect(second).not.toBeVisible();
});

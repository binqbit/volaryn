import type { Locator, Page } from '@playwright/test';

/** Observe the committed layout while a controlled response remains pending. */
export async function paint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Document coordinates exclude scrolling performed to reach a control. */
export async function documentBox(locator: Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  });
}

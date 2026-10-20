import { expect, test, type Page } from '@playwright/test';

// Layout of the non-blocking formats in a
// real browser: jsdom does not lay out, so positions are only checked here.
// `chromium` is a 1280 px desktop, `mobile` a Pixel 7 (412 px).

type Mode = 'banner' | 'slide_in' | 'modal' | 'toast' | 'drawer';

async function present(page: Page, options: { mode: Mode; position?: string; size?: string; duration?: number }) {
  await page.goto('/');
  await page.evaluate((o) => {
    const w = window as unknown as { UIKit: { presentPaywall(o: unknown): Promise<unknown> }; __result?: unknown };
    void w.UIKit.presentPaywall({ paywall: '/paywalls/welcome.json', ...o }).then((r) => (w.__result = r));
  }, options);
  const frame = page.locator(`[data-ui-kit-overlay="${options.mode}"]`);
  await expect(frame).toBeVisible();
  // The 200 ms entrance starts on the first paint after the screen loads: measure once it ended.
  await expect.poll(() => frame.evaluate((el) => el.getAnimations().length)).toBe(0);
  return frame;
}

const viewport = (page: Page) => page.viewportSize()!;

test('a top banner spans the width, leaves the page scrollable and closes with Escape', async ({ page }) => {
  const frame = await present(page, { mode: 'banner', position: 'top' });
  const box = (await frame.boundingBox())!;
  expect(box.y).toBe(0);
  expect(box.width).toBe(viewport(page).width);
  expect(box.height).toBeLessThanOrEqual(viewport(page).height * 0.4 + 1);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  // The SDK adds no close button; the screen has its own. Escape closes once focus is inside.
  await frame.locator('[role="dialog"]').focus();
  await page.keyboard.press('Escape');
  await expect(frame).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __result: unknown }).__result)).toEqual({ outcome: 'closed' });
});

test('a bottom banner touches the bottom edge', async ({ page }) => {
  const frame = await present(page, { mode: 'banner', position: 'bottom' });
  const box = (await frame.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(viewport(page).height);
});

test('a slide-in is a corner card on desktop and a bottom sheet on phones', async ({ page, isMobile }) => {
  const frame = await present(page, { mode: 'slide_in', position: 'bottom_right' });
  const box = (await frame.boundingBox())!;
  const { width, height } = viewport(page);
  if (isMobile) {
    expect(box.x).toBe(0);
    expect(box.width).toBe(width);
    expect(Math.round(box.y + box.height)).toBe(height);
  } else {
    expect(box.width).toBe(380);
    expect(Math.round(width - (box.x + box.width))).toBe(16);
    expect(Math.round(height - (box.y + box.height))).toBe(16);
  }
  // The page under it stays usable: nothing dims or blocks it.
  expect(await page.evaluate(() => document.elementFromPoint(10, 10)?.closest('[data-ui-kit-overlay]'))).toBeNull();
});

test('a small modal is at most 360 px wide', async ({ page }) => {
  await present(page, { mode: 'modal', size: 'small' });
  const box = (await page.getByRole('dialog', { name: 'Paywall' }).boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(360);
});

test('a toast sits at the bottom centre, leaves the page usable and fades out by itself', async ({ page, isMobile }) => {
  const frame = await present(page, { mode: 'toast', duration: 3 });
  const box = (await frame.boundingBox())!;
  const { width, height } = viewport(page);
  expect(box.width).toBeLessThanOrEqual(isMobile ? width - 32 + 1 : 360 + 1);
  expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThanOrEqual(1);
  expect(Math.round(height - (box.y + box.height))).toBe(16);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  expect(await page.evaluate(() => document.elementFromPoint(10, 10)?.closest('[data-ui-kit-overlay]'))).toBeNull();
  await expect(frame).toBeHidden({ timeout: 6000 });
  expect(await page.evaluate(() => (window as unknown as { __result: unknown }).__result)).toEqual({ outcome: 'closed' });
});

test('a toast in the corner becomes a centred note on a phone', async ({ page, isMobile }) => {
  const frame = await present(page, { mode: 'toast', position: 'corner', duration: 60 });
  const box = (await frame.boundingBox())!;
  const { width } = viewport(page);
  if (isMobile) expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThanOrEqual(1);
  else expect(Math.round(width - (box.x + box.width))).toBe(16);
});

test('a side drawer is the full height at the right edge on desktop and the full width on phones', async ({ page, isMobile }) => {
  await present(page, { mode: 'drawer', position: 'right', size: 'medium' });
  const panel = page.getByRole('dialog', { name: 'Details' });
  await expect.poll(() => panel.evaluate((el) => el.getAnimations().length)).toBe(0);
  const box = (await panel.boundingBox())!;
  const { width, height } = viewport(page);
  expect(Math.round(box.height)).toBe(height);
  expect(Math.round(box.x + box.width)).toBe(width);
  expect(Math.round(box.width)).toBe(isMobile ? width : 440);
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-ui-kit-overlay="drawer"]')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
});

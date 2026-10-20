import { expect, test, type Page } from '@playwright/test';

// The SDK on a bare page (tests/e2e/site/index.html), loaded the way a customer does: one <script> tag.
// Playwright locators pierce open shadow roots, so these reach inside the paywall.
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Paywall' });
const result = (page: Page) => page.locator('#result');
const log = (page: Page) => page.getByRole('list', { name: 'Callbacks and events' });
const trigger = (page: Page) => page.locator('[data-trigger]');

test.describe('presentPaywall', () => {
  test('opens a paywall with prices computed from product data', async ({ page }) => {
    await page.goto('/');
    await trigger(page).click();
    await expect(dialog(page).getByText('Independent journalism, without the noise.')).toBeVisible();
    await expect(dialog(page).getByText('$59.99')).toBeVisible();
    await expect(log(page)).toContainText('presentPaywall()');
  });

  test('a successful checkout closes the paywall and reports the package', async ({ page }) => {
    await page.goto('/');
    await trigger(page).click();
    await dialog(page).getByText('Subscribe', { exact: true }).click();
    await expect(dialog(page).getByRole('status', { name: 'Processing' })).toBeVisible();
    await expect(dialog(page)).toBeHidden();
    await expect(result(page)).toContainText('"outcome":"purchased"');
    await expect(result(page)).toContainText(/"packageId":"(monthly|annual)"/);
    await expect(log(page)).toContainText('Checkout paid');
  });

  test('a declined card keeps the paywall open and reports the error', async ({ page }) => {
    await page.goto('/?checkout=declined');
    await trigger(page).click();
    await dialog(page).getByText('Subscribe', { exact: true }).click();
    await expect(result(page)).toContainText('Card declined');
    await expect(log(page)).toContainText('onError');
    await expect(dialog(page)).toBeVisible();
  });

  test('Escape closes, restores focus and unlocks scrolling', async ({ page }) => {
    await page.goto('/');
    await trigger(page).click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await expect(result(page)).toHaveText('{"outcome":"closed"}');
    await expect(log(page)).toContainText('onClose');
    await expect(trigger(page)).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  });

  test('Tab keeps focus inside the paywall', async ({ page }) => {
    await page.goto('/');
    await trigger(page).click();
    await expect(dialog(page).getByText('Independent journalism, without the noise.')).toBeVisible();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => !!document.activeElement?.closest('[data-ui-kit-overlay]'));
      expect(inside).toBe(true);
    }
  });

  test('full screen covers the viewport', async ({ page }) => {
    await page.goto('/?mode=fullscreen');
    await trigger(page).click();
    const box = await dialog(page).boundingBox();
    expect(box?.width).toBeCloseTo(page.viewportSize()!.width, 0);
  });

  test('has no horizontal scroll, with and without an embedded paywall', async ({ page }) => {
    for (const path of ['/', '/?embedded=1']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      // Compare with the device width: on mobile an overflowing page widens innerWidth itself.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
  });
});

test.describe('<uikit-paywall>', () => {
  test('renders embedded and reports purchases as events', async ({ page }) => {
    await page.goto('/?embedded=1');
    const element = page.locator('uikit-paywall');
    await expect(element.getByText('Independent journalism, without the noise.')).toBeVisible();
    await element.getByText('Subscribe', { exact: true }).click();
    await expect(element.getByRole('status', { name: 'Processing' })).toBeVisible();
    await expect(result(page)).toContainText('"element":"purchased"');
    await expect(log(page)).toContainText('uikit-purchased');
    // Inline: the paywall stays on the page after checkout.
    await expect(element.getByText('Subscribe', { exact: true })).toBeVisible();
  });

  test('reports a failed checkout as uikit-error', async ({ page }) => {
    await page.goto('/?embedded=1&checkout=declined');
    await page.locator('uikit-paywall').getByText('Subscribe', { exact: true }).click();
    await expect(result(page)).toContainText('Error: Card declined');
    await expect(log(page)).toContainText('uikit-error');
  });

  test('an embedded survey reports each answer as uikit-action and stays on the page', async ({ page }) => {
    await page.goto('/?paywall=cancel-survey&embedded=1');
    const element = page.locator('uikit-paywall');
    await element.getByText('It’s too expensive').click();
    await expect(result(page)).toContainText('"actionId":"reason_price"');
    await expect(log(page)).toContainText('uikit-action');
    await expect(element.getByText('Something else')).toBeVisible();
  });
});

test.describe('Screens that are not paywalls', () => {
  test('an onboarding button closes the screen and returns its action ID', async ({ page }) => {
    await page.goto('/?paywall=welcome');
    await trigger(page).click();
    await expect(dialog(page).getByText('Five minutes a day. A clearer head all week.')).toBeVisible();
    await dialog(page).getByText('Get started', { exact: true }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(result(page)).toHaveText('{"outcome":"action","actionId":"get_started"}');
    await expect(log(page)).toContainText('onAction');
  });
});

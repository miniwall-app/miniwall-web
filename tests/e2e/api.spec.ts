import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Placements, A/B, audiences, triggers, flows and events end to end. The delivery API is answered by the test
// (page.route on /v1/sdk/...) so the SDK talks to a real browser network stack but no real backend.
const paywall = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(`./site/paywalls/${name}.json`, import.meta.url)), 'utf8'));
const WELCOME = 'Five minutes a day. A clearer head all week.';
const ARTICLE = 'Independent journalism, without the noise.';
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Paywall' });

type SentEvent = { type: string; paywallId?: string; placement?: string; experimentId?: string; variant?: string; actionId?: string };

/** Answers `GET /v1/sdk/<path>` with `body`; records every event batch the SDK posts. */
async function serveApi(page: Page, routes: Record<string, unknown>) {
  const events: SentEvent[] = [];
  await page.route('**/v1/sdk/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/v1/sdk/events') {
      events.push(...(JSON.parse(route.request().postData() ?? '{}').events ?? []));
      return route.fulfill({ status: 204 });
    }
    const body = routes[url.pathname.replace('/v1/sdk', '')];
    return body === undefined ? route.fulfill({ status: 404, json: { error: { message: 'unknown' } } }) : route.fulfill({ json: body });
  });
  return events;
}

const configure = (page: Page, attributes: Record<string, string> = {}) =>
  page.evaluate((attrs) => (window as any).UIKit.configure({ apiKey: 'pk_test', apiUrl: location.origin, attributes: attrs }), attributes);
const present = (page: Page, options: Record<string, unknown>) =>
  page.evaluate((o) => (window as any).UIKit.presentPaywall(o).then((r: unknown) => ((window as any).__result = r)), options);

/** Starts presenting without waiting for the screen to close. */
const start = (page: Page, options: Record<string, unknown>) =>
  page.evaluate((o) => {
    void (window as any).UIKit.presentPaywall(o).then((r: unknown) => ((window as any).__result = r));
  }, options);

const placement = (extra: Record<string, unknown> = {}) => ({
  paywall: paywall('metered-article'),
  paywallId: 'pw_a',
  version: 1,
  placement: 'home',
  ...extra,
});

test.describe('placements', () => {
  test('an A/B test sends a visitor to side B and the events say which side they saw', async ({ page }) => {
    const events = await serveApi(page, {
      '/placements/home': placement({ experiment: { id: 'exp1', shareB: 100, b: { paywall: paywall('welcome'), paywallId: 'pw_b', version: 1, placement: 'home' } } }),
    });
    await page.goto('/');
    await configure(page);
    await start(page, { paywall: { placement: 'home' } });
    await expect(dialog(page).getByText(WELCOME)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(() => events.map((e) => e.type)).toEqual(expect.arrayContaining(['view', 'close']));
    expect(events.find((e) => e.type === 'view')).toMatchObject({ paywallId: 'pw_b', placement: 'home', experimentId: 'exp1', variant: 'b' });
  });

  test('an A/B test with no share for B keeps everyone on A', async ({ page }) => {
    await serveApi(page, {
      '/placements/home': placement({ experiment: { id: 'exp1', shareB: 0, b: { paywall: paywall('welcome'), paywallId: 'pw_b', version: 1 } } }),
    });
    await page.goto('/');
    await configure(page);
    await start(page, { paywall: { placement: 'home' } });
    await expect(dialog(page).getByText(ARTICLE)).toBeVisible();
  });

  test('an audience rule picks the screen from the site attributes, in the browser only', async ({ page }) => {
    const events = await serveApi(page, {
      '/placements/home': placement({
        rules: [{ id: 'pro', conditions: [{ field: 'user.plan', op: 'eq', value: 'pro' }], paywall: { paywall: paywall('welcome'), paywallId: 'pw_pro', version: 1 } }],
      }),
    });
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url() + (r.postData() ?? '')));
    await page.goto('/');
    await configure(page, { plan: 'pro' });
    await start(page, { paywall: { placement: 'home' } });
    await expect(dialog(page).getByText(WELCOME)).toBeVisible();
    await expect.poll(() => events.length).toBeGreaterThan(0);
    // Attributes decide the audience here and are never sent to the server.
    expect(requests.join('\n')).not.toContain('plan');
  });

  test('an audience that shows nothing resolves as skipped and opens no dialog', async ({ page }) => {
    await serveApi(page, {
      '/placements/home': placement({ rules: [{ id: 'free', conditions: [{ field: 'user.plan', op: 'eq', value: 'free' }], paywall: null }] }),
    });
    await page.goto('/');
    await configure(page, { plan: 'free' });
    await present(page, { paywall: { placement: 'home' } });
    expect(await page.evaluate(() => (window as any).__result)).toEqual({ outcome: 'skipped', reason: 'audience' });
    await expect(dialog(page)).toHaveCount(0);
  });

  test('a frequency cap stops the second view', async ({ page }) => {
    await serveApi(page, { '/placements/home': placement({ frequency: { max: 1, per: 'ever' } }) });
    await page.goto('/');
    await configure(page);
    await start(page, { paywall: { placement: 'home' } });
    await expect(dialog(page).getByText(ARTICLE)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeHidden();
    await present(page, { paywall: { placement: 'home' } });
    expect(await page.evaluate(() => (window as any).__result)).toEqual({ outcome: 'skipped', reason: 'frequency_cap' });
  });
});

test.describe('automatic placements', () => {
  test('a delay trigger opens the placement by itself', async ({ page }) => {
    await serveApi(page, {
      '/auto': { placements: [{ placement: 'home', display: null, trigger: { type: 'delay', seconds: 1 } }] },
      '/placements/home': placement(),
    });
    await page.goto('/');
    await configure(page);
    await page.evaluate(() => (window as any).UIKit.startAutoPlacements());
    await expect(dialog(page)).toHaveCount(0);
    await expect(dialog(page).getByText(ARTICLE)).toBeVisible({ timeout: 6000 });
  });

  test('a trigger for another page stays quiet', async ({ page }) => {
    await serveApi(page, {
      '/auto': { placements: [{ placement: 'home', display: null, trigger: { type: 'page_load', pages: ['/pricing'] } }] },
      '/placements/home': placement(),
    });
    await page.goto('/');
    await configure(page);
    await page.evaluate(() => (window as any).UIKit.startAutoPlacements());
    await page.waitForTimeout(1200);
    await expect(dialog(page)).toHaveCount(0);
  });
});

test.describe('flows', () => {
  test('a "Go to screen" button swaps the screen inside the same dialog and keeps one dialog', async ({ page }) => {
    const first = paywall('welcome');
    const stack = first.components_config.base.stack.components[2].components;
    stack[0].triggers = { on_press: 'screen:next' };
    await serveApi(page, {});
    await page.goto('/');
    await configure(page);
    await start(page, { paywall: first, screens: { next: paywall('metered-article') } });
    await expect(dialog(page).getByText(WELCOME)).toBeVisible();
    await dialog(page).getByText('Get started', { exact: true }).click();
    await expect(dialog(page).getByText(ARTICLE)).toBeVisible();
    await expect(dialog(page).getByText(WELCOME)).toHaveCount(0);
    expect(await page.locator('[data-ui-kit-overlay]').count()).toBe(1);
  });
});

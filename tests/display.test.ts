import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sample from './fixtures/sample-paywall.json';
import { configure, presentPaywall } from '../src';
import type { PaywallJson } from '../src';

const paywall = sample as unknown as PaywallJson;
const tick = () => new Promise((r) => setTimeout(r, 0));
const overlay = () => document.querySelector<HTMLElement>('[data-ui-kit-overlay]')!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

let apiUrl = 0;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  configure({ apiKey: 'pk_test', apiUrl: `https://display${++apiUrl}.example.com`, analytics: false });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  document.documentElement.style.overflow = '';
});

const delivery = (display: unknown) =>
  new Response(JSON.stringify({ placement: 'promo', paywallId: 'p1', version: 1, paywall: sample, packages: [], display }), { status: 200 });

describe('banner', () => {
  it('pins a bar to the top without dimming, locking scroll or taking focus', async () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    const result = presentPaywall({ paywall, mode: 'banner' });
    await tick();
    expect(overlay().dataset.uiKitOverlay).toBe('banner');
    expect(overlay().style.top).toBe('0px');
    expect(overlay().style.background).toBe('');
    expect(dialog().getAttribute('aria-modal')).toBe('false');
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.activeElement).toBe(field);
    // The screen brings its own close button; here Escape stands in for it once focus is inside.
    dialog().focus();
    escape();
    await expect(result).resolves.toEqual({ outcome: 'closed' });
    expect(document.querySelector('[data-ui-kit-overlay]')).toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it('sits at the bottom when asked', async () => {
    void presentPaywall({ paywall, mode: 'banner', position: 'bottom' });
    await tick();
    expect(overlay().style.bottom).toBe('0px');
    expect(overlay().dataset.position).toBe('bottom');
  });

  it('ignores Escape typed elsewhere on the page', async () => {
    const result = presentPaywall({ paywall, mode: 'banner' });
    await tick();
    escape();
    expect(document.querySelector('[data-ui-kit-overlay]')).toBeTruthy();
    dialog().focus();
    escape();
    await expect(result).resolves.toEqual({ outcome: 'closed' });
  });
});

describe('slide-in', () => {
  it('is a card in the chosen corner with the chosen width', async () => {
    void presentPaywall({ paywall, mode: 'slide_in', position: 'bottom_left', size: 'small' });
    await tick();
    expect(overlay().style.left).toBe('16px');
    expect(overlay().style.bottom).toBe('16px');
    expect(overlay().style.width).toContain('320px');
  });

  it('adds the phone bottom-sheet rules once', async () => {
    void presentPaywall({ paywall, mode: 'slide_in' });
    await tick();
    void presentPaywall({ paywall, mode: 'slide_in' });
    await tick();
    const sheets = document.querySelectorAll('#uik-present-css');
    expect(sheets).toHaveLength(1);
    expect(sheets[0].textContent).toContain('max-width: 639px');
  });
});

describe('modal size', () => {
  it('maps small / medium / large to 360 / 440 / 560 px, maxContentWidth still wins', async () => {
    void presentPaywall({ paywall, size: 'small' });
    await tick();
    expect(dialog().style.maxWidth).toBe('360px');
    void presentPaywall({ paywall, size: 'large', maxContentWidth: '500px' });
    await tick();
    expect(dialog().style.maxWidth).toBe('500px');
  });

  it('presenting another screen closes the open one, whatever its format', async () => {
    const first = presentPaywall({ paywall, mode: 'banner' });
    await tick();
    void presentPaywall({ paywall });
    await expect(first).resolves.toEqual({ outcome: 'closed' });
    expect(document.querySelectorAll('[data-ui-kit-overlay]')).toHaveLength(1);
  });
});

describe("the placement's display", () => {
  it('is used when the site passes no mode', async () => {
    fetchMock.mockResolvedValueOnce(delivery({ format: 'slide_in', position: 'bottom_center', size: 'large' }));
    void presentPaywall({ paywall: { placement: 'promo' } });
    await vi.waitFor(() => expect(overlay()).toBeTruthy());
    expect(overlay().dataset.uiKitOverlay).toBe('slide_in');
    expect(overlay().dataset.position).toBe('bottom_center');
    expect(overlay().style.width).toContain('440px');
  });

  it("loses to the site's own mode", async () => {
    fetchMock.mockResolvedValueOnce(delivery({ format: 'banner', position: 'bottom' }));
    void presentPaywall({ paywall: { placement: 'promo' }, mode: 'modal' });
    await vi.waitFor(() => expect(overlay()).toBeTruthy());
    expect(overlay().dataset.uiKitOverlay).toBe('modal');
    expect(dialog().getAttribute('aria-modal')).toBe('true');
  });

  it('falls back to a modal when the API sends none', async () => {
    fetchMock.mockResolvedValueOnce(delivery(undefined));
    void presentPaywall({ paywall: { placement: 'promo' } });
    await vi.waitFor(() => expect(overlay()).toBeTruthy());
    expect(overlay().dataset.uiKitOverlay).toBe('modal');
  });
});

describe('close buttons', () => {
  it.each(['modal', 'fullscreen', 'banner', 'slide_in'] as const)('adds none to a %s: the screen carries its own', async (mode) => {
    void presentPaywall({ paywall, mode });
    await tick();
    expect(document.querySelector('[data-ui-kit-close]')).toBeNull();
    expect(overlay().querySelectorAll(':scope > button, [role="dialog"] > button')).toHaveLength(0);
  });
});

describe('toast', () => {
  it('is a polite note at the bottom: no dimming, no scroll lock, no focus taken', async () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    void presentPaywall({ paywall, mode: 'toast' });
    await tick();
    expect(overlay().dataset.uiKitOverlay).toBe('toast');
    expect(overlay().dataset.position).toBe('bottom');
    expect(overlay().style.bottom).toContain('16px');
    expect(overlay().style.background).toBe('');
    expect(document.querySelector('[role="status"]')).toBeTruthy();
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.activeElement).toBe(field);
  });

  it('takes the corner, the top and the width it is told', async () => {
    void presentPaywall({ paywall, mode: 'toast', position: 'corner', size: 'small' });
    await tick();
    expect(overlay().style.right).toBe('16px');
    expect(overlay().style.width).toContain('280px');
  });

  describe('timing', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
    afterEach(() => vi.useRealTimers());

    it('fades out after its duration and resolves as closed, without a close event', async () => {
      configure({ analytics: true });
      const onClose = vi.fn();
      const result = presentPaywall({ paywall, mode: 'toast', duration: 4, onClose });
      await vi.advanceTimersByTimeAsync(0);
      expect(overlay()).toBeTruthy();
      await vi.advanceTimersByTimeAsync(3999);
      expect(document.querySelector('[data-ui-kit-overlay]')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(2);
      await expect(result).resolves.toEqual({ outcome: 'closed' });
      expect(document.querySelector('[data-ui-kit-overlay]')).toBeNull();
      expect(onClose).toHaveBeenCalledTimes(1);
      const events = fetchMock.mock.calls.filter(([url]) => String(url).includes('/events'));
      expect(events.flatMap(([, init]) => JSON.parse(String(init?.body ?? '{}')).events ?? []).some((e: { type: string }) => e.type === 'close')).toBe(false);
    });

    it('waits while the visitor points at it, then stays at least 2 s more', async () => {
      const result = presentPaywall({ paywall, mode: 'toast', duration: 3 });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2500);
      overlay().dispatchEvent(new Event('pointerenter'));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(document.querySelector('[data-ui-kit-overlay]')).toBeTruthy();
      overlay().dispatchEvent(new Event('pointerleave'));
      await vi.advanceTimersByTimeAsync(1900);
      expect(document.querySelector('[data-ui-kit-overlay]')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(200);
      await expect(result).resolves.toEqual({ outcome: 'closed' });
    });
  });

  it('closes on Escape once focus is inside it', async () => {
    const result = presentPaywall({ paywall, mode: 'toast' });
    await tick();
    dialog()?.focus?.();
    (document.querySelector('[role="status"]') as HTMLElement).focus();
    escape();
    await expect(result).resolves.toEqual({ outcome: 'closed' });
  });
});

describe('drawer', () => {
  it('slides over a dimmed page from the right, locks scroll and takes focus', async () => {
    void presentPaywall({ paywall, mode: 'drawer', size: 'large' });
    await tick();
    expect(overlay().dataset.uiKitOverlay).toBe('drawer');
    expect(overlay().dataset.position).toBe('right');
    expect(overlay().style.justifyContent).toBe('flex-end');
    expect(overlay().style.background).toContain('0.4');
    expect(dialog().style.width).toBe('560px');
    expect(dialog().style.height).toBe('100%');
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(dialog());
  });

  it('opens from the left and closes by the backdrop or Escape', async () => {
    const result = presentPaywall({ paywall, mode: 'drawer', position: 'left' });
    await tick();
    expect(overlay().style.justifyContent).toBe('flex-start');
    overlay().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect(result).resolves.toEqual({ outcome: 'closed' });
    expect(document.documentElement.style.overflow).toBe('');
    const again = presentPaywall({ paywall, mode: 'drawer' });
    await tick();
    escape();
    await expect(again).resolves.toEqual({ outcome: 'closed' });
  });
});

describe('formats from the dashboard', () => {
  it('draws a toast from the placement with its duration, and treats a format it does not know as a popup', async () => {
    fetchMock.mockResolvedValueOnce(delivery({ format: 'toast', position: 'top', duration: 9 }));
    void presentPaywall({ paywall: { placement: 'promo' } });
    await vi.waitFor(() => expect(document.querySelector('[data-ui-kit-overlay]')).toBeTruthy());
    expect(overlay().dataset.uiKitOverlay).toBe('toast');
    expect(overlay().dataset.position).toBe('top');
    document.body.innerHTML = '';

    fetchMock.mockResolvedValueOnce(delivery({ format: 'hologram' }));
    void presentPaywall({ paywall: { placement: 'other' } });
    await vi.waitFor(() => expect(document.querySelector('[data-ui-kit-overlay]')).toBeTruthy());
    expect(overlay().dataset.uiKitOverlay).toBe('modal');
  });

  it('opens what a launcher opens when it is called by hand', async () => {
    fetchMock.mockResolvedValueOnce(delivery({ format: 'launcher', label: 'See plans', opens: 'slide_in', position: 'bottom_left' }));
    void presentPaywall({ paywall: { placement: 'promo' }, mode: 'launcher' });
    await vi.waitFor(() => expect(document.querySelector('[data-ui-kit-overlay]')).toBeTruthy());
    expect(overlay().dataset.uiKitOverlay).toBe('slide_in');
    expect(overlay().style.left).toBe('16px');
  });
});

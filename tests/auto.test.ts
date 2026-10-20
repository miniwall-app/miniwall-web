import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sample from './fixtures/sample-paywall.json';
import { configure, presentPaywall, startAutoPlacements } from '../src';
import { matchesPage } from '../src/auto';
import type { AutoPlacementsHandle, Trigger } from '../src';

let apiUrl = 0;
let fetchMock: ReturnType<typeof vi.fn>;
let handle: AutoPlacementsHandle | undefined;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

interface Fake {
  placement: string;
  trigger: Trigger;
  display?: unknown;
  /** Targeting the delivery ships for this placement. */
  frequency?: { max: number; per: string };
  /** More of the delivery: rules, holdout... */
  extra?: Record<string, unknown>;
}

/** A fake API: `/auto` lists the placements, `/placements/:key` delivers each. */
function serve(placements: Fake[]) {
  fetchMock.mockImplementation(async (url: string) => {
    const path = new URL(url).pathname;
    if (path === '/v1/sdk/auto') return json({ placements: placements.map(({ placement, trigger, display }) => ({ placement, trigger, display: display ?? null })) });
    const key = decodeURIComponent(path.split('/').pop()!);
    const p = placements.find((x) => x.placement === key)!;
    return json({ placement: key, paywallId: `pw-${key}`, version: 1, paywall: sample, packages: [], display: p.display ?? null, frequency: p.frequency ?? null, ...p.extra });
  });
}

const shown = () => Array.from(document.querySelectorAll('[data-ui-kit-overlay]'));
const deliveredKeys = () =>
  fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname).filter((p) => p.startsWith('/v1/sdk/placements/')).map((p) => p.split('/').pop());

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  configure({ apiKey: 'pk_test', apiUrl: `https://auto${++apiUrl}.example.com`, analytics: false });
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

afterEach(() => {
  handle?.stop();
  handle = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  document.documentElement.style.overflow = '';
});

describe('matchesPage', () => {
  it('matches exact paths, wildcards and ignores a trailing slash', () => {
    expect(matchesPage(undefined, '/anything')).toBe(true);
    expect(matchesPage([], '/anything')).toBe(true);
    expect(matchesPage(['/pricing'], '/pricing/')).toBe(true);
    expect(matchesPage(['/pricing/'], '/pricing')).toBe(true);
    expect(matchesPage(['/pricing'], '/pricing/team')).toBe(false);
    expect(matchesPage(['/blog/*'], '/blog/a/b')).toBe(true);
    expect(matchesPage(['/blog/*'], '/about')).toBe(false);
    expect(matchesPage(['/a.b'], '/axb')).toBe(false);
    expect(matchesPage(['/'], '/')).toBe(true);
  });

  it('treats * as any run of characters, anywhere in the pattern', () => {
    expect(matchesPage(['*'], '/any/thing')).toBe(true);
    expect(matchesPage(['/*/pricing'], '/en/pricing')).toBe(true);
    expect(matchesPage(['/*/pricing'], '/pricing')).toBe(false);
    expect(matchesPage(['/a*c*e'], '/abcde')).toBe(true);
    expect(matchesPage(['/a*c*e'], '/abde')).toBe(false);
    expect(matchesPage(['/a*a'], '/a')).toBe(false);
    expect(matchesPage(['/a**a'], '/aa')).toBe(true);
    expect(matchesPage(['/x', '/blog/*'], '/blog/post')).toBe(true);
    expect(matchesPage(['/a+b(c)'], '/a+b(c)')).toBe(true);
  });

  it('stays fast on patterns with many wildcards and on long runs of slashes', () => {
    const started = performance.now();
    expect(matchesPage(['/' + '*a'.repeat(40)], '/' + 'a'.repeat(39) + 'b')).toBe(false);
    expect(matchesPage(['/' + '*a'.repeat(40)], '/' + 'a'.repeat(5000) + 'b')).toBe(false);
    expect(matchesPage(['/' + '*a'.repeat(40) + '*'], '/' + 'a'.repeat(5000))).toBe(true);
    expect(matchesPage(['/x'], '/' + '/'.repeat(200_000) + 'x')).toBe(false);
    expect(matchesPage(['/' + '/'.repeat(200_000) + '*'], '/x')).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('startAutoPlacements', () => {
  it('shows a page_load placement with its display', async () => {
    serve([{ placement: 'promo', trigger: { type: 'page_load' }, display: { format: 'banner', position: 'top' } }]);
    handle = startAutoPlacements();
    await vi.waitFor(() => expect(shown()).toHaveLength(1));
    expect(shown()[0].getAttribute('data-ui-kit-overlay')).toBe('banner');
  });

  it('only arms placements whose pages match', async () => {
    serve([{ placement: 'pricing_only', trigger: { type: 'page_load', pages: ['/pricing'] } }]);
    history.replaceState(null, '', '/about');
    handle = startAutoPlacements();
    await new Promise((r) => setTimeout(r, 30));
    expect(shown()).toHaveLength(0);
  });

  it('waits for the delay', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    serve([{ placement: 'later', trigger: { type: 'delay', seconds: 5 } }]);
    handle = startAutoPlacements();
    await vi.advanceTimersByTimeAsync(4000);
    expect(deliveredKeys()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1100);
    expect(deliveredKeys()).toEqual(['later']);
  });

  it('shows one screen per page view: the highest priority', async () => {
    // The API sends them highest priority first.
    serve([
      { placement: 'high', trigger: { type: 'page_load', priority: 10 } },
      { placement: 'low', trigger: { type: 'page_load', priority: 0 } },
    ]);
    handle = startAutoPlacements();
    await vi.waitFor(() => expect(shown()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(deliveredKeys()).toEqual(['high']);
  });

  it('moves to the next placement when targeting skips the first', async () => {
    localStorage.setItem('uikit:shown:high', JSON.stringify({ total: 1, times: [Date.now()] }));
    const onResult = vi.fn();
    serve([
      { placement: 'high', trigger: { type: 'page_load', priority: 10 }, frequency: { max: 1, per: 'ever' } },
      { placement: 'low', trigger: { type: 'page_load' } },
    ]);
    handle = startAutoPlacements({ onResult });
    await vi.waitFor(() => expect(shown()).toHaveLength(1));
    expect(deliveredKeys()).toEqual(['high', 'low']);
    expect(onResult).toHaveBeenCalledWith({ placement: 'high', result: { outcome: 'skipped', reason: 'frequency_cap' } });
  });

  it('never opens over a screen the site presented', async () => {
    serve([{ placement: 'promo', trigger: { type: 'delay', seconds: 0.01 } }]);
    void presentPaywall({ paywall: sample as never });
    await vi.waitFor(() => expect(shown()).toHaveLength(1));
    handle = startAutoPlacements();
    await new Promise((r) => setTimeout(r, 60));
    expect(deliveredKeys()).toEqual([]);
    expect(shown()).toHaveLength(1);
  });

  it('re-arms on a client-side route change', async () => {
    serve([{ placement: 'pricing', trigger: { type: 'page_load', pages: ['/pricing'] } }]);
    handle = startAutoPlacements();
    await new Promise((r) => setTimeout(r, 30));
    expect(shown()).toHaveLength(0);
    history.pushState(null, '', '/pricing');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(shown()).toHaveLength(1));
  });

  it('reports to the site when the list fails to load and arms nothing', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Missing or invalid public key' } }), { status: 401 }));
    const onError = vi.fn();
    handle = startAutoPlacements({ onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(String(onError.mock.calls[0][0])).toContain('invalid public key');
  });

  it('returns the same handle until stopped', () => {
    serve([]);
    handle = startAutoPlacements();
    expect(startAutoPlacements()).toBe(handle);
    handle.stop();
    const again = startAutoPlacements();
    expect(again).not.toBe(handle);
    handle = again;
  });

  it('exit intent does nothing on touch-only devices', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(hover: none)', addEventListener() {}, removeEventListener() {} }));
    serve([{ placement: 'leaving', trigger: { type: 'exit_intent' } }]);
    handle = startAutoPlacements();
    await new Promise((r) => setTimeout(r, 30));
    document.dispatchEvent(new MouseEvent('mouseout', { clientY: -1, relatedTarget: null }));
    await new Promise((r) => setTimeout(r, 30));
    expect(deliveredKeys()).toEqual([]);
  });

  it('exit intent fires when the mouse leaves through the top', async () => {
    serve([{ placement: 'leaving', trigger: { type: 'exit_intent' } }]);
    handle = startAutoPlacements();
    await new Promise((r) => setTimeout(r, 30));
    document.dispatchEvent(new MouseEvent('mouseout', { clientY: 0, relatedTarget: null }));
    await vi.waitFor(() => expect(shown()).toHaveLength(1));
  });
});

describe('launcher', () => {
  const launcher = { format: 'launcher', label: 'See plans', opens: 'modal', position: 'bottom_right' };
  const button = () => document.querySelector<HTMLButtonElement>('[data-ui-kit-launcher]');
  const settle = () => vi.waitFor(() => expect(button()).toBeTruthy());

  it('puts a button on the page when its trigger fires, without taking the one screen of the page', async () => {
    serve([
      { placement: 'plans', trigger: { type: 'page_load', priority: 5 }, display: launcher },
      { placement: 'promo', trigger: { type: 'page_load' }, display: { format: 'banner', position: 'top' } },
    ]);
    handle = startAutoPlacements();
    await settle();
    expect(button()!.textContent).toBe('See plans');
    expect(button()!.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button()!.style.right).toBe('16px');
    // The banner still shows: the launcher did not use up the page's one screen.
    await vi.waitFor(() => expect(shown()).toHaveLength(1));
    expect(shown()[0].getAttribute('data-ui-kit-overlay')).toBe('banner');
  });

  it('opens its screen when pressed, hides while it is up and comes back with focus when it closes', async () => {
    serve([{ placement: 'plans', trigger: { type: 'page_load' }, display: { ...launcher, opens: 'slide_in' } }]);
    const onResult = vi.fn();
    handle = startAutoPlacements({ onResult });
    await settle();
    button()!.click();
    await vi.waitFor(() => expect(shown()).toHaveLength(1));
    expect(shown()[0].getAttribute('data-ui-kit-overlay')).toBe('slide_in');
    expect(button()!.style.display).toBe('none');
    (shown()[0].querySelector('[role="dialog"]') as HTMLElement).focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.waitFor(() => expect(shown()).toHaveLength(0));
    await vi.waitFor(() => expect(button()!.style.display).toBe(''));
    expect(document.activeElement).toBe(button());
    expect(onResult).toHaveBeenCalledWith({ placement: 'plans', result: { outcome: 'closed' } });
  });

  it('is not held back by the frequency cap, which counts when the screen opens', async () => {
    serve([{ placement: 'plans', trigger: { type: 'page_load' }, display: launcher, frequency: { max: 1, per: 'session' } }]);
    sessionStorage.clear();
    handle = startAutoPlacements();
    await settle();
    button()!.click();
    await vi.waitFor(() => expect(shown()).toHaveLength(1));
  });

  it('stays away when the holdout keeps this visitor out, and goes with the page', async () => {
    serve([{ placement: 'plans', trigger: { type: 'page_load' }, display: launcher, extra: { holdout: { id: 'h1', share: 100 } } }]);
    handle = startAutoPlacements();
    await vi.waitFor(() => expect(deliveredKeys()).toContain('plans'));
    await new Promise((r) => setTimeout(r, 20));
    expect(button()).toBeNull();

    serve([{ placement: 'plans', trigger: { type: 'page_load', pages: ['/pricing'] }, display: launcher }]);
    handle.stop();
    history.replaceState(null, '', '/pricing');
    handle = startAutoPlacements();
    await settle();
    handle.stop();
    expect(button()).toBeNull();
  });
});

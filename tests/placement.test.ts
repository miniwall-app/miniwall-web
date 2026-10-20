import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sample from './fixtures/sample-paywall.json';
import { configure } from '../src';
import { bucketOf, resolvePaywall } from '../src/load';
import { withDefaults } from '../src/defaults';
import { settings } from '../src/config';
import type { PaywallOptions } from '../src';

const delivery = { placement: 'upgrade', paywallId: 'p1', version: 3, paywall: sample, packages: ['monthly', 'annual'] };
const ok = (body: unknown, etag = 'W/"v3"') => new Response(JSON.stringify(body), { status: 200, headers: { etag } });

let fetchMock: ReturnType<typeof vi.fn>;
let apiUrl = 0;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // A fresh API URL per test keeps the module-level cache from leaking between tests.
  configure({ apiKey: 'pk_test', apiUrl: `https://api${++apiUrl}.example.com` });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete settings.locale;
});

describe('placements', () => {
  it('loads a placement with the public key', async () => {
    fetchMock.mockResolvedValueOnce(ok(delivery));
    const resolved = await resolvePaywall({ placement: 'upgrade' });
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api${apiUrl}.example.com/v1/sdk/placements/upgrade?key=pk_test&v=2`);
    expect(resolved.paywall!.default_locale).toBe('en_US');
  });

  it('revalidates with the ETag and reuses the cached copy on 304', async () => {
    fetchMock.mockResolvedValueOnce(ok(delivery)).mockResolvedValueOnce(new Response(null, { status: 304 }));
    await resolvePaywall({ placement: 'upgrade' });
    const again = await resolvePaywall({ placement: 'upgrade' });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ cache: 'no-store', headers: { 'if-none-match': 'W/"v3"' } });
    expect(again.paywall!.default_locale).toBe('en_US');
  });

  it('falls back to the last copy when offline or the server fails', async () => {
    fetchMock.mockResolvedValueOnce(ok(delivery)).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await resolvePaywall({ placement: 'upgrade' });
    await expect(resolvePaywall({ placement: 'upgrade' })).resolves.toHaveProperty('paywall');
    await expect(resolvePaywall({ placement: 'upgrade' })).resolves.toHaveProperty('paywall');
  });

  it('reports the server message when there is nothing cached', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Placement not found' } }), { status: 404 }));
    await expect(resolvePaywall({ placement: 'missing' })).rejects.toThrow('UIKit: Placement not found');
  });

  it('needs configure({ apiKey }) first', async () => {
    configure({ apiKey: undefined });
    await expect(resolvePaywall({ placement: 'upgrade' })).rejects.toThrow(/configure/);
  });

  it('loads a specific paywall by id', async () => {
    fetchMock.mockResolvedValueOnce(ok(delivery));
    await resolvePaywall({ paywallId: 'p1' });
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/sdk/paywalls/p1?key=pk_test');
  });
});

describe('withDefaults', () => {
  it('applies the configured locale unless the call sets one', () => {
    configure({ locale: 'vi_VN' });
    expect(withDefaults<PaywallOptions>({ paywall: 'x' }).locale).toBe('vi_VN');
    expect(withDefaults<PaywallOptions>({ paywall: 'x', locale: 'en_US' }).locale).toBe('en_US');
  });
});

describe('A/B tests', () => {
  const withTest = (shareB: number) => ({ ...delivery, experiment: { id: 'exp1', shareB, b: { ...delivery, paywallId: 'p2', version: 1 } } });

  it('keeps each visitor on one side and tags the analytics context', async () => {
    localStorage.setItem('uikit:vid', 'visitor-fixed');
    const expected = bucketOf('exp1', 'visitor-fixed') < 50 ? 'b' : 'a';
    for (let i = 0; i < 3; i++) {
      fetchMock.mockResolvedValueOnce(ok(withTest(50), `W/"${i}"`));
      const resolved = await resolvePaywall({ placement: 'upgrade' });
      expect(resolved.context).toMatchObject({ experimentId: 'exp1', variant: expected, paywallId: expected === 'b' ? 'p2' : 'p1' });
    }
  });

  it('sends everyone to B at 100% and nobody at 0%', async () => {
    fetchMock.mockResolvedValueOnce(ok(withTest(100), 'W/"all"'));
    expect((await resolvePaywall({ placement: 'upgrade' })).context).toMatchObject({ variant: 'b', paywallId: 'p2' });
    fetchMock.mockResolvedValueOnce(ok(withTest(0), 'W/"none"'));
    expect((await resolvePaywall({ placement: 'upgrade' })).context).toMatchObject({ variant: 'a', paywallId: 'p1' });
  });

  it('splits visitors close to the requested share', () => {
    const inB = Array.from({ length: 10_000 }, (_, i) => bucketOf('exp-split', `visitor-${i}`) < 30).filter(Boolean).length;
    expect(inB / 10_000).toBeGreaterThan(0.27);
    expect(inB / 10_000).toBeLessThan(0.33);
  });
});

describe('icons', () => {
  const CHECK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';

  it('hands the icon drawings of the delivery to the renderer, so no icon service is asked', async () => {
    const { iconSvg } = await import('@miniwall/render');
    fetchMock.mockResolvedValueOnce(ok({ ...delivery, assets: { icons: { 'lucide/check': CHECK }, fonts: {} } }));
    await resolvePaywall({ placement: 'upgrade' });
    expect(iconSvg('lucide/check')).toBe(CHECK);
  });

  it('also takes the drawings of an A/B side and of an audience screen', async () => {
    const { iconSvg } = await import('@miniwall/render');
    const side = { ...delivery, assets: { icons: { 'lucide/star': CHECK } } };
    const audience = { ...delivery, assets: { icons: { 'lucide/gem': CHECK } } };
    fetchMock.mockResolvedValueOnce(ok({ ...delivery, experiment: { id: 'e1', shareB: 50, b: side }, rules: [{ id: 'r1', conditions: [], paywall: audience }] }));
    await resolvePaywall({ placement: 'upgrade' });
    expect(iconSvg('lucide/star')).toBe(CHECK);
    expect(iconSvg('lucide/gem')).toBe(CHECK);
  });

  it('still works against an older API with no assets', async () => {
    fetchMock.mockResolvedValueOnce(ok(delivery));
    await expect(resolvePaywall({ placement: 'upgrade' })).resolves.toBeTruthy();
  });
});

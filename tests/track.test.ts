import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure } from '../src';
import { createTracker, flush, reportPurchase } from '../src/track';

let fetchMock: ReturnType<typeof vi.fn>;
const sent = () => fetchMock.mock.calls.flatMap(([, init]) => JSON.parse(init.body).events);

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  configure({ apiKey: 'pk_test', apiUrl: 'https://api.example.com', analytics: true });
});

afterEach(() => {
  flush();
  vi.unstubAllGlobals();
});

describe('analytics', () => {
  it('batches events with the paywall context and a stable anonymous visitor id', () => {
    const track = createTracker({ paywallId: 'pw1', version: 3, placement: 'upgrade' });
    track('view');
    track('purchase_click', 'annual');
    expect(fetchMock).not.toHaveBeenCalled();
    flush();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/sdk/events?key=pk_test');
    expect(init.headers).toEqual({ 'content-type': 'text/plain' });
    const [view, click] = sent();
    expect(view).toMatchObject({ type: 'view', paywallId: 'pw1', version: 3, placement: 'upgrade' });
    expect(click).toMatchObject({ type: 'purchase_click', packageId: 'annual' });
    expect(view.visitorId).toBe(click.visitorId);
    expect(view.visitorId).toBe(localStorage.getItem('uikit:vid'));
  });

  it('records "Run your code" presses with their action ID, not as a package', () => {
    const track = createTracker({ paywallId: 'pw1', version: 1 });
    track('action', 'get_started');
    track('action'); // no ID: nothing to count
    flush();
    expect(sent()).toEqual([expect.objectContaining({ type: 'action', actionId: 'get_started', paywallId: 'pw1' })]);
    expect(sent()[0].packageId).toBeUndefined();
  });

  it('sends nothing for paywalls loaded from JSON or when analytics is off', () => {
    createTracker(undefined)('view');
    configure({ analytics: false });
    createTracker({ paywallId: 'pw1' })('view');
    flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reportPurchase attributes a redirect checkout to the paywall where buy was tapped', () => {
    createTracker({ paywallId: 'pw1', version: 2, placement: 'upgrade' })('purchase_click', 'monthly');
    flush();
    fetchMock.mockClear();
    reportPurchase();
    expect(sent()).toEqual([expect.objectContaining({ type: 'purchase', paywallId: 'pw1', version: 2, placement: 'upgrade', packageId: 'monthly' })]);
    fetchMock.mockClear();
    reportPurchase(); // already reported
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses sendBeacon when the page is going away', () => {
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    createTracker({ paywallId: 'pw1' })('close');
    flush(true);
    expect(beacon).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws when the network fails', () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    createTracker({ paywallId: 'pw1' })('view');
    expect(() => flush()).not.toThrow();
  });
});

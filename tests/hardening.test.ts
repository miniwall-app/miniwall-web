import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sample from './fixtures/sample-paywall.json';
import { configure } from '../src';
import { resolvePaywall } from '../src/load';
import { settings } from '../src/config';
import { isOpenableUrl } from '../src/url';

// Release hardening: links a paywall may open, and a hanging network.

describe('isOpenableUrl', () => {
  it('opens web pages, email and phone links', () => {
    for (const url of ['https://example.com/terms', 'http://a.b', 'mailto:help@site.com', 'tel:+84123', '/privacy']) {
      expect(isOpenableUrl(url), url).toBe(true);
    }
  });

  it('never opens script or data links', () => {
    for (const url of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>x', 'vbscript:x', '//evil.com']) {
      expect(isOpenableUrl(url), url).toBe(false);
    }
  });
});

describe('a slow delivery API', () => {
  let apiUrl = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    configure({ apiKey: 'pk_test', apiUrl: `https://slow${++apiUrl}.example.com`, timeoutMs: 1000 });
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete settings.timeoutMs;
  });

  const hanging = () =>
    vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));

  it('gives up after the timeout instead of waiting forever', async () => {
    vi.stubGlobal('fetch', hanging());
    const pending = resolvePaywall({ placement: 'upgrade' });
    const assertion = expect(pending).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });

  it('shows the last copy when the network hangs', async () => {
    const delivery = { placement: 'upgrade', paywallId: 'p1', version: 1, paywall: sample };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(delivery), { status: 200, headers: { etag: 'W/"1"' } })));
    await resolvePaywall({ placement: 'upgrade' });
    vi.stubGlobal('fetch', hanging());
    const pending = resolvePaywall({ placement: 'upgrade' });
    await vi.advanceTimersByTimeAsync(1001);
    expect((await pending).paywall?.default_locale).toBe('en_US');
  });
});

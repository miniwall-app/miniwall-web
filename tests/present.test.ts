// Interaction with the rendered paywall (purchase, busy state, focus) needs a real
// browser: the renderer does not paint under jsdom. See sdks/web/tests/e2e.
import { afterEach, describe, expect, it, vi } from 'vitest';
import sample from './fixtures/sample-paywall.json';
import { loadPaywall, mountPaywall, presentPaywall } from '../src';
import type { PaywallJson } from '../src';

const paywall = sample as unknown as PaywallJson;
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.style.overflow = '';
});

describe('loadPaywall', () => {
  it('accepts the JSON, the { paywallData } wrapper, and rejects anything else', async () => {
    await expect(loadPaywall(paywall)).resolves.toBe(paywall);
    await expect(loadPaywall({ paywallData: paywall } as never)).resolves.toBe(paywall);
    await expect(loadPaywall({ foo: 1 } as never)).rejects.toThrow(/Not a paywall/);
  });

  it('fetches a URL and reports HTTP errors', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(paywall)))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(loadPaywall('https://cdn.example.com/p.json')).resolves.toMatchObject({ default_locale: 'en_US' });
    await expect(loadPaywall('https://cdn.example.com/missing.json')).rejects.toThrow(/404/);
    fetchMock.mockRestore();
  });
});

describe('presentPaywall', () => {
  it('opens a modal dialog with the paywall in a shadow root and locks page scroll', async () => {
    void presentPaywall({ paywall });
    await tick();
    expect(document.querySelector('[role="dialog"][aria-modal="true"]')).toBeTruthy();
    expect(document.querySelector('[data-ui-kit-paywall]')?.shadowRoot).toBeTruthy();
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('resolves "closed" on Escape, calls onClose and cleans up', async () => {
    const onClose = vi.fn();
    const result = presentPaywall({ paywall, onClose });
    await tick();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(result).resolves.toEqual({ outcome: 'closed' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-ui-kit-overlay]')).toBeNull();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('closes on a backdrop click but not on a click inside the dialog', async () => {
    const result = presentPaywall({ paywall });
    await tick();
    document.querySelector<HTMLElement>('[role="dialog"]')!.click();
    expect(document.querySelector('[data-ui-kit-overlay]')).toBeTruthy();
    document.querySelector<HTMLElement>('[data-ui-kit-overlay]')!.click();
    await expect(result).resolves.toEqual({ outcome: 'closed' });
  });

  it('fullscreen mode ignores backdrop clicks', async () => {
    const result = presentPaywall({ paywall, mode: 'fullscreen' });
    await tick();
    document.querySelector<HTMLElement>('[data-ui-kit-overlay]')!.click();
    expect(document.querySelector('[data-ui-kit-overlay="fullscreen"]')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(result).resolves.toEqual({ outcome: 'closed' });
  });

  it('returns focus to where it was before opening', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const result = presentPaywall({ paywall });
    await tick();
    expect(document.activeElement).not.toBe(trigger);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await result;
    expect(document.activeElement).toBe(trigger);
  });

  it('presenting a second paywall closes the first', async () => {
    const first = presentPaywall({ paywall });
    await tick();
    void presentPaywall({ paywall });
    await expect(first).resolves.toEqual({ outcome: 'closed' });
    await tick();
    expect(document.querySelectorAll('[data-ui-kit-overlay]')).toHaveLength(1);
  });

  it('rejects without opening anything when the paywall cannot be loaded', async () => {
    await expect(presentPaywall({ paywall: { nope: true } as never })).rejects.toThrow(/Not a paywall/);
    expect(document.querySelector('[data-ui-kit-overlay]')).toBeNull();
  });
});

describe('mountPaywall', () => {
  it('renders inline and destroy() removes it', async () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const handle = await mountPaywall(container, { paywall });
    expect(container.querySelector('[data-ui-kit-paywall]')).toBeTruthy();
    handle.destroy();
    expect(container.children).toHaveLength(0);
  });
});

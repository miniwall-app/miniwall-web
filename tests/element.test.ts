import { afterEach, describe, expect, it, vi } from 'vitest';
import sample from './fixtures/sample-paywall.json';
import { definePaywallElement } from '../src';
import type { PaywallElement, PaywallJson } from '../src';

const paywall = sample as unknown as PaywallJson;

definePaywallElement();

function create(setup: (el: PaywallElement) => void = () => {}) {
  const el = document.createElement('uikit-paywall') as PaywallElement;
  setup(el);
  document.body.appendChild(el);
  return el;
}

const nextEvent = (el: HTMLElement, type: string) => new Promise<CustomEvent>((resolve) => el.addEventListener(type, (e) => resolve(e as CustomEvent), { once: true }));
const hosts = (el: HTMLElement) => el.querySelectorAll('[data-ui-kit-paywall]').length;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('<uikit-paywall>', () => {
  it('renders the paywall set as a property and fires uikit-ready', async () => {
    const el = create();
    const ready = nextEvent(el, 'uikit-ready');
    el.paywall = paywall;
    await ready;
    expect(hosts(el)).toBe(1);
    expect(el.style.display).toBe('block');
  });

  it('coalesces several changes into one render and replaces, not stacks, on change', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(paywall)));
    const el = create((e) => {
      e.setAttribute('src', 'https://cdn.example.com/a.json');
      e.setAttribute('locale', 'en_US');
      e.products = { annual: { price: 59.99, currency: 'USD', period: 'year' } };
    });
    await nextEvent(el, 'uikit-ready');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const again = nextEvent(el, 'uikit-ready');
    el.setAttribute('src', 'https://cdn.example.com/b.json');
    await again;
    expect(fetchMock.mock.calls[1][0]).toBe('https://cdn.example.com/b.json');
    expect(hosts(el)).toBe(1);
  });

  it('reports load failures as uikit-error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const el = create((e) => e.setAttribute('src', 'https://cdn.example.com/missing.json'));
    const { detail } = await nextEvent(el, 'uikit-error');
    expect(String(detail.error)).toMatch(/404/);
    expect(hosts(el)).toBe(0);
  });

  it('cleans up when removed from the page', async () => {
    const el = create((e) => (e.paywall = paywall));
    await nextEvent(el, 'uikit-ready');
    el.remove();
    expect(hosts(el)).toBe(0);
  });

  it('defines itself once and accepts a custom tag name', () => {
    definePaywallElement();
    definePaywallElement('my-paywall');
    expect(customElements.get('uikit-paywall')).toBeDefined();
    expect(customElements.get('my-paywall')).toBeDefined();
    expect(customElements.get('my-paywall')).not.toBe(customElements.get('uikit-paywall'));
  });
});

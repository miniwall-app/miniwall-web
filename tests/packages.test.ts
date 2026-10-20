import { describe, expect, it, vi } from 'vitest';
import sample from './fixtures/sample-paywall.json';
import { getPackageIds, productsFromStripe } from '../src';
import { missingProducts } from '../src/packages';
import type { PaywallJson } from '../src';

const paywall = sample as unknown as PaywallJson;

describe('package IDs', () => {
  it('lists the IDs the package cards use', () => {
    expect(getPackageIds(paywall).sort()).toEqual(['annual', 'monthly']);
  });

  it('reports packages the host gave no price for', () => {
    expect(missingProducts(paywall, { annual: { price: 1, currency: 'USD' } })).toEqual(['monthly']);
    expect(missingProducts(paywall, undefined).sort()).toEqual(['annual', 'monthly']);
  });
});

describe('productsFromStripe', () => {
  it('converts Stripe prices, including zero-decimal currencies and one-off prices', () => {
    const products = productsFromStripe({
      monthly: { unit_amount: 999, currency: 'usd', recurring: { interval: 'month', interval_count: 1 }, product: { name: 'Pro' } },
      annual: { unit_amount: 1_490_000, currency: 'vnd', recurring: { interval: 'year', interval_count: 1 }, nickname: 'Yearly' },
      lifetime: { unit_amount: 14900, currency: 'eur', recurring: null },
      custom: { unit_amount: null, currency: 'usd' },
    });
    expect(products).toEqual({
      monthly: { price: 9.99, currency: 'USD', period: { unit: 'month', count: 1 }, title: 'Pro' },
      annual: { price: 1_490_000, currency: 'VND', period: { unit: 'year', count: 1 }, title: 'Yearly' },
      lifetime: { price: 149, currency: 'EUR', period: 'lifetime', title: undefined },
    });
  });
});

describe('missing price warning', () => {
  it('warns once per render, naming the package IDs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { presentPaywall } = await import('../src');
    void presentPaywall({ paywall, products: { monthly: { price: 1, currency: 'USD' } } });
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('annual'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    warn.mockRestore();
  });
});

describe('custom fonts', () => {
  it('turns fonts declared in the paywall into renderer font config', async () => {
    const { fontsFromPaywall, parseFontName } = await import('../src');
    const url = 'https://cdn.jsdelivr.net/npm/@fontsource/fraunces@5.3.0/files/fraunces-latin-700-normal.woff2';
    const fonts = fontsFromPaywall({
      components_config: {
        base: {},
        fonts: { 'Fraunces@700': { web: url }, 'Custom Font': { web: url }, 'Bad@700': { web: 'http://insecure' } },
      },
    } as never);
    expect(Object.keys(fonts)).toEqual(['Fraunces@700']);
    expect(fonts['Fraunces@700'].web).toMatchObject({ family: 'Fraunces', weight: 700, url, style: 'normal' });
    expect(parseFontName('DM Serif Display@400')).toEqual({ family: 'DM Serif Display', weight: 400 });
    expect(parseFontName('OLD:Fraunces@600')).toEqual({ family: 'Fraunces', weight: 600 });
    expect(fontsFromPaywall(null)).toEqual({});
  });
});

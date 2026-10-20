import { describe, expect, it } from 'vitest';
import { buildProductVariables } from '../src/pricing';

describe('buildProductVariables', () => {
  const vars = buildProductVariables(
    {
      monthly: { price: 9.99, currency: 'USD', period: 'month' },
      annual: { price: 59.99, currency: 'USD', period: 'year', title: 'Pro yearly', offer: { price: 0, period: { unit: 'day', count: 7 } } },
      lifetime: { price: 149, currency: 'USD', period: 'lifetime' },
    },
    'en_US'
  );

  it('formats price, currency and period', () => {
    expect(vars.monthly).toMatchObject({
      'product.price': '$9.99',
      'product.currency_code': 'USD',
      'product.currency_symbol': '$',
      'product.period': 'month',
      'product.period_abbreviated': 'mo',
      'product.periodly': 'monthly',
      'product.price_per_period': '$9.99/month',
      'product.price_per_period_abbreviated': '$9.99/mo',
    });
  });

  it('derives per-unit prices from the billing period', () => {
    expect(vars.annual['product.price_per_month']).toBe('$5.00');
    expect(vars.annual['product.price_per_year']).toBe('$59.99');
    expect(vars.annual['product.period_in_months']).toBe('12');
  });

  it('computes relative discount against the most expensive monthly price', () => {
    expect(vars.annual['product.relative_discount']).toBe('50%');
    expect(vars.monthly['product.relative_discount']).toBeUndefined();
  });

  it('describes offers and lifetime products', () => {
    expect(vars.annual).toMatchObject({ 'product.offer_price': '$0.00', 'product.offer_period': '7 days', 'product.store_product_name': 'Pro yearly' });
    expect(vars.lifetime['product.price_per_period']).toBe('$149.00');
    expect(vars.lifetime['product.price_per_month']).toBeUndefined();
  });

  it('uses the paywall locale for number formatting', () => {
    const vi = buildProductVariables({ p: { price: 99000, currency: 'VND', period: 'month' } }, 'vi_VN');
    expect(vi.p['product.price']).toMatch(/99\.000/);
  });
});

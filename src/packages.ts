import type { PaywallJson, ProductInfo } from './types';

/** Walks every node object in the paywall tree (children, wrappers, overrides alike). */
function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((v) => walk(v, visit));
  const node = value as Record<string, unknown>;
  if (typeof node.type === 'string') visit(node);
  for (const child of Object.values(node)) if (child && typeof child === 'object') walk(child, visit);
}

/**
 * The package IDs a paywall's package cards use, i.e. the keys your app should
 * pass in `products` and will receive in `onPurchase({ packageId })`.
 */
export function getPackageIds(paywall: PaywallJson): string[] {
  const ids = new Set<string>();
  walk(paywall.components_config?.base, (node) => {
    if (node.type === 'package' && typeof node.package_id === 'string' && node.package_id) ids.add(node.package_id);
  });
  return [...ids];
}

/** Package IDs the paywall shows that have no price from the host. */
export function missingProducts(paywall: PaywallJson, products: Record<string, ProductInfo> | undefined): string[] {
  return getPackageIds(paywall).filter((id) => !products?.[id]);
}

/** The fields of a Stripe `Price` object this helper reads. */
export interface StripePriceLike {
  unit_amount: number | null;
  currency: string;
  recurring?: { interval: 'day' | 'week' | 'month' | 'year'; interval_count: number } | null;
  nickname?: string | null;
  product?: string | { name?: string } | null;
}

// Stripe amounts are in the smallest unit except for these currencies.
// https://docs.stripe.com/currencies#zero-decimal
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);

/**
 * Turns Stripe `Price` objects (fetched by your server, e.g. with
 * `stripe.prices.retrieve(id, { expand: ['product'] })`) into the `products`
 * option, keyed by package ID: `productsFromStripe({ monthly: price1, annual: price2 })`.
 */
export function productsFromStripe(prices: Record<string, StripePriceLike>): Record<string, ProductInfo> {
  const products: Record<string, ProductInfo> = {};
  for (const [packageId, price] of Object.entries(prices)) {
    if (price.unit_amount === null) continue;
    const currency = price.currency.toLowerCase();
    const amount = ZERO_DECIMAL.has(currency) ? price.unit_amount : price.unit_amount / 100;
    const name = typeof price.product === 'object' && price.product ? price.product.name : undefined;
    products[packageId] = {
      price: amount,
      currency: currency.toUpperCase(),
      period: price.recurring ? { unit: price.recurring.interval, count: price.recurring.interval_count } : 'lifetime',
      title: name ?? price.nickname ?? undefined,
    };
  }
  return products;
}

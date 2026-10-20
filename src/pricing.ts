import type { Period, PeriodUnit, ProductInfo } from './types';

type Variables = Record<string, string>;

const DAYS: Record<PeriodUnit, number> = { day: 1, week: 7, month: 365 / 12, year: 365 };
const ABBREVIATION: Record<PeriodUnit, string> = { day: 'day', week: 'wk', month: 'mo', year: 'yr' };
const PERIODLY: Record<PeriodUnit, string> = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' };

/** `en_US` (paywall JSON) → `en-US` (Intl). */
export function toBcp47(locale: string | undefined): string | undefined {
  return locale?.replace('_', '-');
}

function normalize(period: Period | undefined): { unit: PeriodUnit; count: number } | 'lifetime' | undefined {
  if (period === undefined || period === 'lifetime') return period;
  return typeof period === 'string' ? { unit: period, count: 1 } : period;
}

function money(amount: number, currency: string, locale: string | undefined): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

function currencySymbol(currency: string, locale: string | undefined): string {
  const part = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency');
  return part?.value ?? currency;
}

function periodVariables(prefix: 'product' | 'product.offer', period: Period | undefined): Variables {
  const k = prefix === 'product' ? 'product.' : 'product.offer_';
  const p = normalize(period);
  if (p === undefined) return {};
  if (p === 'lifetime') {
    return { [k + `period`]: 'lifetime', [k + `period_abbreviated`]: 'lifetime', [k + `period_with_unit`]: 'lifetime' };
  }
  const days = DAYS[p.unit] * p.count;
  const plural = p.count === 1 ? p.unit : `${p.unit}s`;
  const vars: Variables = {
    [k + `period`]: p.count === 1 ? p.unit : `${p.count} ${plural}`,
    [k + `period_abbreviated`]: p.count === 1 ? ABBREVIATION[p.unit] : `${p.count} ${ABBREVIATION[p.unit]}`,
    [k + `period_with_unit`]: `${p.count} ${plural}`,
    [k + `period_in_days`]: String(Math.round(days)),
    [k + `period_in_weeks`]: String(Math.round(days / 7)),
    [k + `period_in_months`]: String(Math.round(days / DAYS.month)),
    [k + `period_in_years`]: String(Math.floor(days / DAYS.year)),
  };
  if (prefix === 'product') vars['product.periodly'] = p.count === 1 ? PERIODLY[p.unit] : `every ${p.count} ${plural}`;
  return vars;
}

function pricePerVariables(prefix: 'product' | 'product.offer', price: number, currency: string, period: Period | undefined, locale?: string): Variables {
  const p = normalize(period);
  if (!p || p === 'lifetime') return {};
  const days = DAYS[p.unit] * p.count;
  const key = prefix === 'product' ? 'product.price_per_' : 'product.offer_price_per_';
  const vars: Variables = {};
  for (const unit of ['day', 'week', 'month', 'year'] as const) {
    vars[key + unit] = money((price / days) * DAYS[unit], currency, locale);
  }
  return vars;
}

function monthlyPrice(product: ProductInfo): number | undefined {
  const p = normalize(product.period);
  if (!p || p === 'lifetime') return undefined;
  return product.price / ((DAYS[p.unit] * p.count) / DAYS.month);
}

/**
 * Builds the `{{ product.* }}` values the paywall text uses, per package, from
 * plain price data. `relative_discount` compares each package's monthly price
 * with the most expensive package's, e.g. annual vs monthly → "33%".
 */
export function buildProductVariables(products: Record<string, ProductInfo>, locale?: string): Record<string, Variables> {
  const intl = toBcp47(locale);
  const monthly = Object.values(products).map(monthlyPrice).filter((v): v is number => v !== undefined);
  const highestMonthly = monthly.length > 1 ? Math.max(...monthly) : undefined;

  const result: Record<string, Variables> = {};
  for (const [packageId, product] of Object.entries(products)) {
    const price = money(product.price, product.currency, intl);
    const period = periodVariables('product', product.period);
    const vars: Variables = {
      'product.price': price,
      'product.currency_code': product.currency.toUpperCase(),
      'product.currency_symbol': currencySymbol(product.currency, intl),
      ...period,
      ...pricePerVariables('product', product.price, product.currency, product.period, intl),
    };
    if (period['product.period']) {
      vars['product.price_per_period'] = product.period === 'lifetime' ? price : `${price}/${period['product.period']}`;
      vars['product.price_per_period_abbreviated'] = product.period === 'lifetime' ? price : `${price}/${period['product.period_abbreviated']}`;
    }
    if (product.title) vars['product.store_product_name'] = product.title;

    const own = monthlyPrice(product);
    if (highestMonthly && own !== undefined && own < highestMonthly) {
      vars['product.relative_discount'] = `${Math.round((1 - own / highestMonthly) * 100)}%`;
    }

    if (product.offer) {
      vars['product.offer_price'] = money(product.offer.price, product.currency, intl);
      Object.assign(vars, periodVariables('product.offer', product.offer.period));
      Object.assign(vars, pricePerVariables('product.offer', product.offer.price, product.currency, product.offer.period, intl));
    }
    result[packageId] = vars;
  }
  return result;
}

export { configure, setAttributes } from './config';
export { loadPaywall } from './load';
export { mountPaywall } from './mount';
export { presentPaywall } from './present';
export { startAutoPlacements } from './auto';
export { buildProductVariables } from './pricing';
export { getPackageIds, productsFromStripe } from './packages';
export { reportPurchase } from './track';
export { definePaywallElement } from './element';
export { fontsFromPaywall, parseFontName } from './fonts';
export type { PaywallElement } from './element';
export type { StripePriceLike } from './packages';
export type {
  Answers,
  Attributes,
  AutoPlacementsHandle,
  AutoPlacementsOptions,
  ColorMode,
  Display,
  DisplayFormat,
  DisplayPosition,
  DisplaySize,
  ConfigureOptions,
  PaywallHandle,
  PaywallJson,
  PaywallOptions,
  PaywallSource,
  Period,
  PeriodUnit,
  PresentOptions,
  ProductInfo,
  PurchaseResult,
  SkipReason,
  Trigger,
  TriggerType,
} from './types';

export const version = '0.1.0';

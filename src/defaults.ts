import { settings } from './config';
import type { PaywallOptions } from './types';

/** Applies configure() defaults; per-call options win. */
export function withDefaults<T extends PaywallOptions>(options: T): T {
  return { ...options, locale: options.locale ?? settings.locale, colorMode: options.colorMode ?? settings.colorMode };
}

import type { ConfigureOptions } from './types';

export const DEFAULT_API_URL = 'https://api.miniwall.app';

export const settings: Required<Pick<ConfigureOptions, 'apiUrl'>> & ConfigureOptions = { apiUrl: DEFAULT_API_URL };

/**
 * Adds to (or changes) the visitor attributes used by placement audiences,
 * e.g. after sign-in: `setAttributes({ plan: 'pro' })`. `null` removes one.
 */
export function setAttributes(attributes: NonNullable<ConfigureOptions['attributes']>): void {
  const next = { ...settings.attributes, ...attributes };
  for (const [key, value] of Object.entries(next)) if (value === null) delete next[key];
  settings.attributes = next;
}

/** Call once at startup: `configure({ apiKey: 'pk_...' })`. */
export function configure(options: ConfigureOptions): void {
  Object.assign(settings, options);
  if (options.apiUrl) settings.apiUrl = options.apiUrl.replace(/\/$/, '');
}

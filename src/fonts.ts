import type { PaywallJson } from './types';

/** Shape the renderer (`@miniwall/render`) expects in `uiConfig.app.fonts`. */
export type RendererFonts = Record<
  string,
  { web: { type: 'url'; value: string; family: string; hash: string; style: string; url: string; weight: number } }
>;

/**
 * Custom fonts live in the paywall JSON itself: `components_config.fonts` maps
 * a name like `Fraunces@700` to its web file (`{ web: "https://…woff2" }`),
 * and text nodes use that name in `font_name`. This turns them into the
 * renderer's font config so every surface (SDK, preview, editor canvas,
 * thumbnails) loads the same files.
 */
export function fontsFromPaywall(paywall: Pick<PaywallJson, 'components_config'> | null | undefined): RendererFonts {
  const declared = (paywall?.components_config as { fonts?: Record<string, { web?: string }> } | undefined)?.fonts ?? {};
  const fonts: RendererFonts = {};
  for (const [name, platforms] of Object.entries(declared)) {
    const parsed = parseFontName(name);
    const url = platforms?.web;
    if (!parsed || !url || !/^https:\/\//.test(url)) continue;
    fonts[name] = { web: { type: 'url', value: url, url, family: parsed.family, weight: parsed.weight, style: 'normal', hash: '' } };
  }
  return fonts;
}

/**
 * `Fraunces@700` → { family: "Fraunces", weight: 700 }; anything else → null.
 * An upper-case `PREFIX:` in front (older saved paywalls) is ignored.
 */
export function parseFontName(name: string): { family: string; weight: number } | null {
  const match = /^(?:[A-Z]+:)?(.+)@(\d{3})$/.exec(name);
  return match ? { family: match[1], weight: Number(match[2]) } : null;
}

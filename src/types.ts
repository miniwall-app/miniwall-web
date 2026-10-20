/**
 * The paywall JSON exported from the dashboard (the renderer's `PaywallData`).
 * Kept structural here so this package's public types stand alone.
 */
export interface PaywallJson {
  default_locale: string;
  components_config: { base: Record<string, unknown>; [key: string]: unknown };
  components_localizations: Record<string, Record<string, string>>;
  [key: string]: unknown;
}

/**
 * Where to get a paywall:
 * - `{ placement: 'upgrade_button' }`: whatever paywall the dashboard assigns to
 *   that placement (needs `configure({ apiKey })`); changes without a deploy;
 * - `{ paywallId }`: one specific published paywall;
 * - the JSON itself, or a URL that returns it (exported from the dashboard).
 */
export type PaywallSource = { placement: string } | { paywallId: string } | PaywallJson | string;

export interface ConfigureOptions {
  /** The project's public key (`pk_...`) from the dashboard. */
  apiKey?: string;
  /** Override the delivery API, e.g. for self-hosting. */
  apiUrl?: string;
  /** Defaults for every paywall; per-call options win. */
  locale?: string;
  colorMode?: ColorMode;
  /**
   * Send views, closes and purchase taps to the dashboard's Analytics
   * (paywalls loaded by placement or paywallId only). Default `true`.
   */
  analytics?: boolean;
  /**
   * What you know about the visitor (`{ plan: 'free', country: 'VN' }`), for
   * placement audiences (`user.plan` in the dashboard). Stays in the browser:
   * never sent to Miniwall. Update later with `setAttributes()`.
   */
  attributes?: Attributes;
  /**
   * How long to wait for the delivery API, in milliseconds. Past it, the
   * last copy this browser saw is shown, or the call fails. Default 8000.
   */
  timeoutMs?: number;
}

/** Visitor attributes for audiences; checked in the browser only. */
export type Attributes = Record<string, string | number | boolean | null | undefined>;

/**
 * Why a placement showed nothing: the visitor hit its frequency cap, an
 * audience set to "Nothing" matched, or they are in the holdout group.
 */
export type SkipReason = 'frequency_cap' | 'audience' | 'holdout';

/**
 * Answers to the questions on the screens shown so far, by field ID (set in
 * the editor): the chosen option ID, a list of them for a multiple choice, or
 * the text typed into a text field. Kept in the browser; only chosen option
 * IDs are counted in Analytics, never typed text.
 */
export type Answers = Record<string, string | string[]>;

export type PeriodUnit = 'day' | 'week' | 'month' | 'year';
export type Period = PeriodUnit | 'lifetime' | { unit: PeriodUnit; count: number };

/** What the host knows about the product behind one package. Prices are in
 * major units (9.99, not 999). */
export interface ProductInfo {
  price: number;
  currency: string;
  period?: Period;
  /** Store/product name shown by `{{ product.store_product_name }}`. */
  title?: string;
  /** Introductory or trial offer. A free trial is `price: 0`. */
  offer?: { price: number; period: Period };
}

export type ColorMode = 'light' | 'dark' | 'system';

/** `answers` is set when the visitor answered at least one question. */
export type PurchaseResult =
  | { outcome: 'purchased'; packageId: string; answers?: Answers }
  | { outcome: 'restored'; answers?: Answers }
  | { outcome: 'closed'; answers?: Answers }
  /** A "Run your code" button was pressed (onboarding, prompts, surveys...). */
  | { outcome: 'action'; actionId: string; answers?: Answers }
  /** Targeting decided not to show anything (placements only); nothing opened. */
  | { outcome: 'skipped'; reason: SkipReason };

export interface PaywallOptions {
  /** The paywall JSON or a URL to it. */
  paywall: PaywallSource;
  /** Locale to render, e.g. `vi_VN`. Falls back to the paywall's default locale. */
  locale?: string;
  colorMode?: ColorMode;
  /**
   * Price of each package, keyed by the package IDs set in the editor (see
   * `getPackageIds`). Take them from your store or Stripe (`productsFromStripe`);
   * they fill every `{{ product.* }}` text.
   */
  products?: Record<string, ProductInfo>;
  /** Extra `{{ product.* }}` values per package, overriding computed ones. */
  variablesPerPackage?: Record<string, Record<string, string>>;
  /** Values for `{{ custom.name }}` in paywall text. */
  customVariables?: Record<string, string | number | boolean>;
  /**
   * Called when the user taps a purchase button. Run your checkout here.
   * Resolve `true` (or nothing) when the purchase succeeded, `false` when the
   * user cancelled; throw on failure. The paywall shows a busy state meanwhile.
   */
  onPurchase?: (args: { packageId: string; product?: ProductInfo; answers: Answers }) => Promise<boolean | void> | boolean | void;
  /** Called for "Restore purchases". Resolve `true` when something was restored. */
  onRestore?: () => Promise<boolean | void> | boolean | void;
  /** Called when the user closes the paywall (close button, Esc, backdrop). */
  onClose?: () => void;
  /**
   * A "Run your code" button was pressed; `actionId` is the ID set in the
   * editor (e.g. `get_started`). Return `false` to keep a presented screen
   * open (otherwise it closes and resolves `{ outcome: 'action', actionId }`).
   */
  onAction?: (args: { actionId: string; answers: Answers }) => Promise<boolean | void> | boolean | void;
  /**
   * The visitor changed an answer. `value` is that field's answer now (an
   * option ID, a list of them, or the typed text; `undefined` once cleared).
   */
  onAnswer?: (args: { fieldId: string; value: string | string[] | undefined; answers: Answers }) => void;
  /**
   * Screens a "Go to screen" button can open, by paywall ID, for JSON/URL
   * sources. Paywalls loaded by placement or paywallId fetch linked screens
   * from Miniwall instead (published versions).
   */
  screens?: Record<string, PaywallJson | string>;
  /** Merged over `configure({ attributes })` for this call's audiences. */
  attributes?: Attributes;
  /** The placement's targeting chose to show nothing (see `SkipReason`). */
  onSkip?: (args: { reason: SkipReason }) => void;
  /** Links in the paywall. Default: open in a new tab. */
  onOpenUrl?: (url: string) => void;
  onError?: (error: unknown) => void;
  /** Max width of the paywall content, e.g. `480px`. */
  maxContentWidth?: string;
}

export interface PaywallHandle {
  /** Remove the paywall and free its resources. */
  destroy(): void;
  /** Answers the visitor gave so far (`{}` without questions). */
  answers(): Answers;
  /** `false` when targeting chose to show nothing; see `skipReason`. */
  shown: boolean;
  skipReason?: SkipReason;
}

/**
 * How a presented screen appears:
 * - `modal`: centered dialog over a dimmed page;
 * - `fullscreen`: covers the viewport;
 * - `banner`: a full-width bar pinned to the top or bottom, page stays usable;
 * - `slide_in`: a card in a bottom corner, a bottom sheet on phones; page stays usable.
 * - `toast`: a small note that fades out by itself; page stays usable.
 * - `drawer`: a panel sliding in from the left or right over a dimmed page.
 * - `launcher`: a floating button on the page that opens the screen when pressed (needs a trigger to appear).
 */
export type DisplayFormat = 'modal' | 'fullscreen' | 'banner' | 'slide_in' | 'toast' | 'drawer' | 'launcher';
export type DisplayPosition = 'top' | 'bottom' | 'bottom_right' | 'bottom_left' | 'bottom_center' | 'corner' | 'left' | 'right';
export type DisplaySize = 'small' | 'medium' | 'large';

/** A placement's display, set in the dashboard. */
export interface Display {
  format: DisplayFormat;
  /** `top`/`bottom` for a banner; `bottom_right`/`bottom_left`/`bottom_center` for a slide-in. */
  position?: DisplayPosition;
  /** Width of a modal (360/440/560 px), a slide-in (320/380/440 px), a toast (280/360/440 px) or a drawer (360/440/560 px). */
  size?: DisplaySize;
  /** `toast`: seconds before it fades out (3 to 60, default 6). */
  duration?: number;
  /** `launcher`: the button's text. */
  label?: string;
  /** `launcher`: how the screen opens when the button is pressed. Default `modal`. */
  opens?: 'modal' | 'slide_in';
}

export type TriggerType = 'manual' | 'page_load' | 'delay' | 'scroll' | 'exit_intent';

/** When a placement shows itself, for `startAutoPlacements()`. */
export interface Trigger {
  type: TriggerType;
  /** `delay`: seconds on the page. */
  seconds?: number;
  /** `scroll`: percent of the page scrolled. */
  percent?: number;
  /** Path patterns (`/pricing`, `/blog/*`); empty or missing = every page. */
  pages?: string[];
  /** Higher goes first when several fire at once. Default 0. */
  priority?: number;
}

export interface PresentOptions extends PaywallOptions {
  /**
   * How the screen appears. Default: the placement's display from the
   * dashboard, otherwise `modal`.
   */
  mode?: DisplayFormat;
  /** Where a `banner`, `slide_in`, `toast` or `drawer` sits. Default: the placement's, otherwise `top` / `bottom_right` / `bottom` / `right`. */
  position?: DisplayPosition;
  /** Width of a `modal`, `slide_in`, `toast` or `drawer`. Default: the placement's, otherwise `medium`. */
  size?: DisplaySize;
  /** Seconds a `toast` stays before it fades out (3 to 60). Default: the placement's, otherwise 6. */
  duration?: number;
  /** Close when the dimmed area around a modal is clicked. Default `true`. */
  closeOnBackdrop?: boolean;
}

/** Options for `startAutoPlacements()`: every presentPaywall option but the source and display. */
export interface AutoPlacementsOptions extends Omit<PaywallOptions, 'paywall'> {
  /** A screen shown by a trigger finished, or targeting chose to show nothing. */
  onResult?: (args: { placement: string; result: PurchaseResult }) => void;
}

export interface AutoPlacementsHandle {
  /** Re-arms the triggers for the current page now (e.g. after a route change). */
  refresh(): void;
  /** Removes every trigger. A screen already open stays open. */
  stop(): void;
}

import { registerIcons } from '@miniwall/render';
import { settings } from './config';
import type { Attributes, Display, PaywallJson, PaywallSource, SkipReason, Trigger } from './types';
import { visitorId, type PaywallContext } from './track';
import { firstMatch, isCapped, type Condition, type FrequencyCap } from './targeting';

export type ResolvedPaywall =
  | {
      paywall: PaywallJson;
      /** Set when the paywall came from the delivery API; used for analytics. */
      context?: PaywallContext;
      /** The placement's display from the dashboard (placements only). */
      display?: Display | null;
      skip?: undefined;
    }
  | {
      paywall?: undefined;
      /** The screen the visitor would have seen (for holdout analytics). */
      context?: PaywallContext;
      skip: SkipReason;
    };

/** What targeting checks against; only placements use it. */
export interface TargetingInput {
  attributes: Attributes;
  locale?: string;
  /** A launcher's button is pressed on purpose: its frequency cap is not asked again. */
  ignoreCap?: boolean;
}

interface Delivery {
  paywall: unknown;
  paywallId?: string;
  version?: number;
  placement?: string | null;
  /** A running A/B test on the placement: side B, shown to `shareB` percent of visitors. */
  experiment?: { id: string; shareB: number; b: Delivery } | null;
  /** Audiences in order; `paywall: null` shows nothing. */
  rules?: { id: string; conditions: Condition[]; paywall: Delivery | null }[];
  frequency?: FrequencyCap | null;
  holdout?: { id: string; share: number } | null;
  /** How the placement shows its screen; older APIs omit it. */
  display?: Display | null;
  trigger?: Trigger | null;
  /** Drawings the screen needs (`icons`: `lucide/check` -> SVG markup). Older APIs omit it; the node's own icon link is then used. */
  assets?: { icons?: Record<string, string> };
}

function contextOf(body: Delivery): PaywallContext | undefined {
  return body.paywallId ? { paywallId: body.paywallId, version: body.version, placement: body.placement ?? null } : undefined;
}

/** FNV-1a: a fast, stable hash so a visitor lands on the same side every time. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 0-99 for this visitor in this test; a new test reshuffles everyone. */
export function bucketOf(experimentId: string, visitor: string): number {
  return hash(`${experimentId}:${visitor}`) % 100;
}

function pickSide(body: Delivery): { paywall: PaywallJson; context?: PaywallContext } {
  const test = body.experiment;
  if (!test?.b) return { paywall: asPaywall(body.paywall), context: contextOf(body) };
  const variant = bucketOf(test.id, visitorId()) < test.shareB ? 'b' : 'a';
  const chosen = variant === 'b' ? test.b : body;
  const context = contextOf(chosen);
  return { paywall: asPaywall(chosen.paywall), context: context && { ...context, experimentId: test.id, variant } };
}

/**
 * Targeting for a placement, in order: frequency cap, first matching
 * audience, then the holdout. An audience's screen is shown as is; the
 * placement's A/B test only splits visitors who matched no audience.
 */
function decide(body: Delivery, input: TargetingInput): ResolvedPaywall {
  const placement = body.placement ?? '';
  if (placement && !input.ignoreCap && isCapped(placement, body.frequency)) return { skip: 'frequency_cap' };
  const rule = placement ? firstMatch(body.rules ?? [], { placement, ...input }) : undefined;
  if (rule && !rule.paywall) return { skip: 'audience' };
  const chosen = rule?.paywall ? { paywall: asPaywall(rule.paywall.paywall), context: contextOf(rule.paywall) } : pickSide(body);
  const holdout = body.holdout;
  if (holdout && holdout.share > 0 && bucketOf(`holdout:${holdout.id}`, visitorId()) < holdout.share) {
    return { skip: 'holdout', context: chosen.context };
  }
  return chosen;
}

function isPaywallJson(value: unknown): value is PaywallJson {
  const v = value as PaywallJson | null;
  return !!v && typeof v === 'object' && !!v.components_config?.base && typeof v.components_config.base === 'object';
}

function asPaywall(value: unknown): PaywallJson {
  const unwrapped = (value as { paywallData?: unknown })?.paywallData ?? value;
  if (!isPaywallJson(unwrapped)) throw new Error('Not a paywall JSON: expected components_config.base');
  unwrapped.components_localizations ??= {};
  return unwrapped;
}

const CACHE_PREFIX = 'uikit:v1:';
const DEFAULT_TIMEOUT_MS = 8000;
const memory = new Map<string, { etag: string | null; body: Delivery }>();

function readCache(url: string) {
  if (memory.has(url)) return memory.get(url)!;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + url);
    return raw ? (JSON.parse(raw) as { etag: string | null; body: Delivery }) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(url: string, entry: { etag: string | null; body: Delivery }) {
  memory.set(url, entry);
  try {
    localStorage.setItem(CACHE_PREFIX + url, JSON.stringify(entry));
  } catch {
    // storage full or blocked: the in-memory copy still serves this page
  }
}

/**
 * Fetches from the delivery API with an ETag revalidation. When the network
 * or server fails, the last copy this browser saw is used instead, so a
 * published paywall keeps working offline.
 */
async function fetchDelivery(path: string): Promise<Delivery> {
  const body = await fetchDeliveryBody(path);
  registerDeliveryIcons(body);
  return body;
}

/**
 * Hands the icon drawings a delivery carries (and those of its A/B side and audience screens) to the renderer, so an icon is drawn from
 * them and not from a request to a public icon service that may be slow, blocked or rate limited. Runs for a cached copy too.
 */
function registerDeliveryIcons(body: Delivery | null | undefined, depth = 0): void {
  if (!body || typeof body !== 'object' || depth > 3) return;
  registerIcons(body.assets?.icons);
  if (body.experiment?.b) registerDeliveryIcons(body.experiment.b, depth + 1);
  for (const rule of body.rules ?? []) registerDeliveryIcons(rule.paywall, depth + 1);
}

async function fetchDeliveryBody(path: string): Promise<Delivery> {
  if (!settings.apiKey) throw new Error('UIKit: call configure({ apiKey }) before loading a placement');
  // v=2: this SDK can draw toast, drawer and launcher; an older one is never sent them.
  const url = `${settings.apiUrl}/v1/sdk${path}?key=${encodeURIComponent(settings.apiKey)}&v=2`;
  const cached = readCache(url);
  let response: Response;
  // A slow or hanging network must not leave the site waiting forever: past
  // the timeout the last copy is used, or the call fails.
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), settings.timeoutMs ?? DEFAULT_TIMEOUT_MS) : null;
  try {
    // The SDK keeps its own copy and revalidates it by ETag, so the browser's
    // HTTP cache is skipped: a new publish must show on the next load.
    response = await fetch(url, {
      cache: 'no-store',
      headers: cached?.etag ? { 'if-none-match': cached.etag } : {},
      signal: controller?.signal,
    });
  } catch (error) {
    if (cached) return cached.body;
    if (controller?.signal.aborted) throw new Error('UIKit: the paywall took too long to load');
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  if (response.status === 304 && cached) return cached.body;
  if (!response.ok) {
    if (cached && response.status >= 500) return cached.body;
    const message = ((await response.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(`UIKit: ${message ?? `could not load paywall (${response.status})`}`);
  }
  const body = (await response.json()) as Delivery;
  writeCache(url, { etag: response.headers.get('etag'), body });
  return body;
}

/**
 * `targeting` applies a placement's audiences, cap and holdout; without it
 * (as in `loadPaywall`) a placement resolves to its default screen.
 */
export async function resolvePaywall(source: PaywallSource, init?: RequestInit, targeting?: TargetingInput): Promise<ResolvedPaywall> {
  if (typeof source === 'object' && source !== null && 'placement' in source && typeof source.placement === 'string') {
    const body = await fetchDelivery(`/placements/${encodeURIComponent(source.placement)}`);
    const resolved: ResolvedPaywall = targeting ? decide(body, targeting) : pickSide(body);
    return resolved.skip ? resolved : { ...resolved, display: body.display ?? null };
  }
  if (typeof source === 'object' && source !== null && 'paywallId' in source && typeof source.paywallId === 'string') {
    const body = await fetchDelivery(`/paywalls/${encodeURIComponent(source.paywallId)}`);
    return { paywall: asPaywall(body.paywall), context: contextOf(body) };
  }
  if (typeof source === 'string') {
    const response = await fetch(source, { headers: { accept: 'application/json' }, ...init });
    if (!response.ok) throw new Error(`Could not load paywall (${response.status}) from ${source}`);
    return { paywall: asPaywall(await response.json()) };
  }
  return { paywall: asPaywall(source) };
}

/** A placement that shows itself, from `GET /v1/sdk/auto`. */
export interface AutoPlacement {
  placement: string;
  display: Display | null;
  trigger: Trigger;
}

/** The project's self-triggering placements, highest priority first. */
export async function fetchAutoPlacements(): Promise<AutoPlacement[]> {
  const body = (await fetchDelivery('/auto')) as unknown as { placements?: AutoPlacement[] };
  return Array.isArray(body.placements) ? body.placements : [];
}

/**
 * A screen a "Go to screen" button opens: from the site's `screens` when it
 * passed one for this ID, otherwise the published paywall from Miniwall.
 */
export function resolveScreen(id: string, screens: Record<string, PaywallJson | string> | undefined): Promise<ResolvedPaywall> {
  const local = screens?.[id];
  return resolvePaywall(local ?? { paywallId: id });
}

/** Resolves any paywall source to its JSON. */
export async function loadPaywall(source: PaywallSource, init?: RequestInit): Promise<PaywallJson> {
  return (await resolvePaywall(source, init)).paywall!;
}

/** Attributes for one call: configure() defaults, then this call's own. */
export function targetingInput(options: { attributes?: Attributes; locale?: string }): TargetingInput {
  return { attributes: { ...settings.attributes, ...options.attributes }, locale: options.locale };
}

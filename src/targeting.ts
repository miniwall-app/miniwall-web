/**
 * Placement targeting, decided in the browser:
 * audiences checked against the site's attributes, a per-visitor frequency
 * cap and a holdout. Attributes are only read here; they are never sent.
 */
import type { Attributes, SkipReason } from './types';

export type Operator = 'eq' | 'neq' | 'contains' | 'starts_with' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'not_exists';

export interface Condition {
  field: string;
  op: Operator;
  value?: string | number | boolean;
}

export interface FrequencyCap {
  max: number;
  per: 'session' | 'day' | 'week' | 'ever';
}

type Value = string | number | boolean | null | undefined;

const SHOWN_PREFIX = 'uikit:shown:';
const SESSION_PREFIX = 'uikit:session-shown:';
const FIRST_SEEN_KEY = 'uikit:first-seen';
const KEEP_TIMES = 100;
const DAY_MS = 86_400_000;

function read<T>(storage: Storage | undefined, key: string): T | null {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(storage: Storage | undefined, key: string, value: unknown) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Blocked storage: the cap and counters simply do not persist.
  }
}

const local = () => (typeof localStorage === 'undefined' ? undefined : localStorage);
const session = () => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);

interface ShownLog {
  total: number;
  /** Most recent show times (ms), newest last. */
  times: number[];
}

function shownLog(placement: string): ShownLog {
  return read<ShownLog>(local(), SHOWN_PREFIX + placement) ?? { total: 0, times: [] };
}

/** Counts one view of a placement, for the frequency cap and `seen_count`. */
export function recordShown(placement: string, now = Date.now()): void {
  const log = shownLog(placement);
  write(local(), SHOWN_PREFIX + placement, { total: log.total + 1, times: [...log.times, now].slice(-KEEP_TIMES) });
  write(session(), SESSION_PREFIX + placement, (read<number>(session(), SESSION_PREFIX + placement) ?? 0) + 1);
}

/** True when this visitor already saw the placement `max` times in the period. */
export function isCapped(placement: string, cap: FrequencyCap | null | undefined, now = Date.now()): boolean {
  if (!cap) return false;
  const log = shownLog(placement);
  const count =
    cap.per === 'session' ? read<number>(session(), SESSION_PREFIX + placement) ?? 0
    : cap.per === 'ever' ? log.total
    : log.times.filter((t) => now - t < (cap.per === 'day' ? DAY_MS : 7 * DAY_MS)).length;
  return count >= cap.max;
}

/** Days since this browser first loaded a Miniwall placement (0 on the first day). */
function daysSinceFirstSeen(now: number): number {
  let first = read<number>(local(), FIRST_SEEN_KEY);
  if (!first) {
    first = now;
    write(local(), FIRST_SEEN_KEY, first);
  }
  return Math.floor((now - first) / DAY_MS);
}

export function deviceType(): 'mobile' | 'tablet' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return /Android/i.test(ua) && !/Mobi/i.test(ua) ? 'tablet' : 'mobile';
  return 'desktop';
}

/** What a condition's `field` reads: built-ins, or `user.<key>` from the site's attributes. */
export function fieldValue(field: string, input: { placement: string; attributes: Attributes; locale?: string; now?: number }): Value {
  const now = input.now ?? Date.now();
  if (field.startsWith('user.')) return input.attributes[field.slice(5)];
  switch (field) {
    case 'locale':
      return input.locale ?? (typeof navigator !== 'undefined' ? navigator.language : undefined);
    case 'device':
      return deviceType();
    case 'path':
      return typeof location !== 'undefined' ? location.pathname : undefined;
    case 'seen_count':
      return shownLog(input.placement).total;
    case 'days_since_first_seen':
      return daysSinceFirstSeen(now);
    default:
      return undefined;
  }
}

const text = (v: Value) => String(v).toLowerCase();
const numeric = (v: Value) => (v === null || v === undefined || v === '' || typeof v === 'boolean' ? NaN : Number(v));

export function matches(condition: Condition, actual: Value): boolean {
  const has = actual !== undefined && actual !== null && actual !== '';
  const expected = condition.value;
  switch (condition.op) {
    case 'exists':
      return has;
    case 'not_exists':
      return !has;
    case 'eq':
      return has && text(actual) === text(expected);
    case 'neq':
      return !has || text(actual) !== text(expected);
    case 'contains':
      return has && text(actual).includes(text(expected));
    case 'starts_with':
      return has && text(actual).startsWith(text(expected));
    default: {
      const a = numeric(actual);
      const b = numeric(expected);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      return condition.op === 'gt' ? a > b : condition.op === 'gte' ? a >= b : condition.op === 'lt' ? a < b : a <= b;
    }
  }
}

/** The first rule whose conditions all hold, or undefined. */
export function firstMatch<R extends { conditions: Condition[] }>(rules: R[], input: { placement: string; attributes: Attributes; locale?: string }): R | undefined {
  return rules.find((rule) => rule.conditions.every((c) => matches(c, fieldValue(c.field, input))));
}

// ── Exposure memory for reportPurchase() ───────────────────────────────────

const EXPOSURE_KEY = 'uikit:last-exposure';
const EXPOSURE_TTL_MS = 30 * DAY_MS;

export interface Exposure {
  paywallId: string;
  version?: number;
  placement: string;
  heldOut: boolean;
  at: number;
}

/** The last placement this visitor met (shown or held out), so a later purchase can be attributed. */
export function rememberExposure(exposure: Omit<Exposure, 'at'>, now = Date.now()): void {
  write(local(), EXPOSURE_KEY, { ...exposure, at: now });
}

export function lastExposure(now = Date.now()): Exposure | null {
  const exposure = read<Exposure>(local(), EXPOSURE_KEY);
  return exposure && now - exposure.at < EXPOSURE_TTL_MS ? exposure : null;
}

export type { SkipReason };

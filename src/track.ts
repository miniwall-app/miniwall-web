import { settings } from './config';
import { lastExposure, recordShown, rememberExposure } from './targeting';

export type EventType =
  | 'view'
  | 'close'
  | 'purchase_click'
  | 'purchase'
  | 'purchase_cancel'
  | 'purchase_error'
  | 'restore'
  | 'action'
  /** The visitor was held out: the placement showed nothing on purpose. */
  | 'holdout'
  /** A purchase by a held-out visitor, reported with reportPurchase(). */
  | 'holdout_purchase'
  /** One chosen option of a choice question (never typed text). */
  | 'answer';

/** Which published paywall an event belongs to (known when it came from the delivery API). */
export interface PaywallContext {
  paywallId: string;
  version?: number;
  placement?: string | null;
  /** Set when an A/B test on the placement picked this paywall. */
  experimentId?: string;
  variant?: 'a' | 'b';
}

interface QueuedEvent extends Partial<PaywallContext> {
  type: EventType;
  packageId?: string;
  /** For `action`: the ID of the "Run your code" button that was pressed. */
  actionId?: string;
  /** For `answer`: the question's field ID and the chosen option's ID. */
  fieldId?: string;
  optionId?: string;
  visitorId: string;
  occurredAt: string;
}

const VISITOR_KEY = 'uikit:vid';
const PENDING_PURCHASE_KEY = 'uikit:pending-purchase';
const FLUSH_DELAY_MS = 2000;
const MAX_BATCH = 50;

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;
let memoryVisitorId: string | null = null;

/** A random ID kept in this browser to count unique visitors; never a user identity. */
export function visitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    memoryVisitorId ??= crypto.randomUUID();
    return memoryVisitorId;
  }
}

function endpoint(): string | null {
  if (!settings.apiKey || settings.analytics === false) return null;
  return `${settings.apiUrl}/v1/sdk/events?key=${encodeURIComponent(settings.apiKey)}`;
}

/** Sends queued events. On page exit it uses sendBeacon, which survives unload. */
export function flush(useBeacon = false): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const url = endpoint();
  if (!url || queue.length === 0) {
    queue = [];
    return;
  }
  while (queue.length > 0) {
    const body = JSON.stringify({ events: queue.splice(0, MAX_BATCH) });
    // text/plain keeps this a "simple" request: no CORS preflight, and it is
    // the only type sendBeacon can send.
    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) continue;
    void fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, keepalive: true }).catch(() => {
      // Analytics must never break the host page.
    });
  }
}

function enqueue(event: Omit<QueuedEvent, 'visitorId' | 'occurredAt'>): void {
  if (!endpoint()) return;
  queue.push({ ...event, visitorId: visitorId(), occurredAt: new Date().toISOString() });
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    window.addEventListener('pagehide', () => flush(true));
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush(true));
  }
  if (queue.length >= MAX_BATCH) flush();
  else timer ??= setTimeout(() => flush(), FLUSH_DELAY_MS);
}

/**
 * Records events for one rendered paywall. Without a context (JSON/URL
 * sources) nothing is sent. `id` is the package ID, or for `action` the
 * action ID.
 */
export type Tracker = (type: EventType, id?: string, answer?: { fieldId: string; optionId: string }) => void;

export function createTracker(context: PaywallContext | undefined): Tracker {
  return (type, id, answer) => {
    if (!context) return;
    if (type === 'answer') {
      if (answer) enqueue({ type, ...answer, ...context });
      return;
    }
    // Counted even with analytics off: the frequency cap and seen_count need it.
    if (context.placement && (type === 'view' || type === 'holdout')) {
      if (type === 'view') recordShown(context.placement);
      rememberExposure({ paywallId: context.paywallId, version: context.version, placement: context.placement, heldOut: type === 'holdout' });
    }
    if (type === 'action') {
      if (id) enqueue({ type, actionId: id, ...context });
      return;
    }
    if (type === 'purchase_click' && id) rememberPendingPurchase({ ...context, packageId: id });
    if (type === 'purchase' || type === 'purchase_cancel') forgetPendingPurchase();
    enqueue({ type, packageId: id, ...context });
  };
}

function rememberPendingPurchase(value: PaywallContext & { packageId: string }) {
  try {
    localStorage.setItem(PENDING_PURCHASE_KEY, JSON.stringify(value));
  } catch {
    // no storage: reportPurchase() will need the paywallId passed explicitly
  }
}

function forgetPendingPurchase() {
  try {
    localStorage.removeItem(PENDING_PURCHASE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Records a completed purchase that finished outside `onPurchase`, e.g. after
 * a redirect to Stripe Checkout: call it on your success page. It attributes
 * the purchase to the paywall where the user last tapped buy; without a buy
 * tap, to the last placement the visitor met (shown or held out). With a
 * holdout, call it for every purchase so the two groups compare fairly.
 */
export function reportPurchase(details: { packageId?: string; paywallId?: string } = {}): void {
  let pending: (PaywallContext & { packageId?: string }) | null = null;
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_PURCHASE_KEY) ?? 'null');
  } catch {
    pending = null;
  }
  if (!pending && !details.paywallId) {
    // No buy tap to attribute: credit the last placement this visitor met,
    // which is what holdout results compare.
    const exposure = lastExposure();
    if (!exposure) return;
    enqueue({
      type: exposure.heldOut ? 'holdout_purchase' : 'purchase',
      paywallId: exposure.paywallId,
      version: exposure.version,
      placement: exposure.placement,
      packageId: details.packageId,
    });
    flush();
    return;
  }
  const paywallId = details.paywallId ?? pending?.paywallId;
  if (!paywallId) return;
  forgetPendingPurchase();
  enqueue({ type: 'purchase', ...pending, paywallId, packageId: details.packageId ?? pending?.packageId });
  flush();
}

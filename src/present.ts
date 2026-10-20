import { resolvePaywall, targetingInput } from './load';
import { withDefaults } from './defaults';
import { renderPaywall } from './render';
import { createTracker } from './track';
import type { Answers, Display, DisplayFormat, DisplayPosition, DisplaySize, PresentOptions, PurchaseResult } from './types';

/** Adds the visitor's answers to a result when there are any. */
const withAnswers = (result: PurchaseResult, answers: Answers): PurchaseResult =>
  result.outcome !== 'skipped' && Object.keys(answers).length ? { ...result, answers } : result;

let closeCurrent: (() => void) | null = null;
let currentOverlay: HTMLElement | null = null;

/**
 * True while a presented screen is open (any format). A screen the site
 * removed from the DOM itself (e.g. an SPA replacing <body>) no longer counts.
 */
export function isPresenting(): boolean {
  return closeCurrent !== null && !!currentOverlay?.isConnected;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

function focusableIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

const WIDTHS: Record<'modal' | 'slide_in' | 'toast' | 'drawer', Record<DisplaySize, string>> = {
  modal: { small: '360px', medium: '440px', large: '560px' },
  slide_in: { small: '320px', medium: '380px', large: '440px' },
  toast: { small: '280px', medium: '360px', large: '440px' },
  drawer: { small: '360px', medium: '440px', large: '560px' },
};

/** Seconds a toast stays when nothing says; it never closes sooner than this after the visitor lets go of it. */
const TOAST_SECONDS = 6;
const TOAST_MIN_LEFT_MS = 2000;

const KNOWN_FORMATS: readonly DisplayFormat[] = ['modal', 'fullscreen', 'banner', 'slide_in', 'toast', 'drawer', 'launcher'];

/**
 * Phone layout, entrance motion and reduced motion. Inline styles carry the
 * layout (host CSS cannot break them); this sheet only adds what inline
 * styles cannot express, hence the !important.
 */
const SHEET_ID = 'uik-present-css';
const SHEET = `
@keyframes uik-from-top { from { transform: translateY(-100%); opacity: 0; } }
@keyframes uik-from-bottom { from { transform: translateY(100%); opacity: 0; } }
@keyframes uik-rise { from { transform: translateY(16px); opacity: 0; } }
@keyframes uik-drop { from { transform: translateY(-16px); opacity: 0; } }
@keyframes uik-from-right { from { transform: translateX(100%); } }
@keyframes uik-from-left { from { transform: translateX(-100%); } }
@keyframes uik-fade { from { opacity: 0; } }
[data-ui-kit-overlay="banner"][data-position="top"] { animation: uik-from-top 200ms ease-out; }
[data-ui-kit-overlay="banner"][data-position="bottom"] { animation: uik-from-bottom 200ms ease-out; }
[data-ui-kit-overlay="slide_in"] { animation: uik-rise 200ms ease-out; }
[data-ui-kit-overlay="toast"] { animation: uik-rise 200ms ease-out; }
[data-ui-kit-overlay="toast"][data-position="top"] { animation-name: uik-drop; }
[data-ui-kit-overlay="drawer"] { animation: uik-fade 200ms ease-out; }
[data-ui-kit-overlay="drawer"][data-position="right"] > [role="dialog"] { animation: uik-from-right 200ms ease-out; }
[data-ui-kit-overlay="drawer"][data-position="left"] > [role="dialog"] { animation: uik-from-left 200ms ease-out; }
@media (max-width: 639px) {
  [data-ui-kit-overlay="slide_in"] { left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100% !important; margin: 0 !important; animation-name: uik-from-bottom; }
  [data-ui-kit-overlay="slide_in"] > [role="dialog"] { border-radius: 16px 16px 0 0 !important; max-height: 85dvh !important; }
}
@media (max-width: 639px) {
  [data-ui-kit-overlay="toast"][data-position="corner"] { left: 0 !important; right: 0 !important; margin: 0 auto !important; }
  [data-ui-kit-overlay="drawer"] > [role="dialog"] { width: 100% !important; max-width: 100% !important; }
}
@media (prefers-reduced-motion: reduce) { [data-ui-kit-overlay], [data-ui-kit-overlay] > [role="dialog"] { animation: none !important; } }
`;

function ensureSheet() {
  if (document.getElementById(SHEET_ID)) return;
  const style = document.createElement('style');
  style.id = SHEET_ID;
  style.textContent = SHEET;
  document.head.appendChild(style);
}

interface Layout {
  format: DisplayFormat;
  position: DisplayPosition;
  size: DisplaySize;
  /** Toast: seconds before it fades out. */
  duration: number;
}

const DEFAULT_POSITION: Partial<Record<DisplayFormat, DisplayPosition>> = { banner: 'top', toast: 'bottom', drawer: 'right' };

/**
 * The call's own choice wins, then the placement's display, then modal. A format this SDK does not
 * know (a newer one) is a modal, and a launcher called by hand opens what it opens.
 */
function layoutOf(options: PresentOptions, display: Display | null | undefined): Layout {
  const fromPlacement = options.mode === undefined ? display : undefined;
  let format: DisplayFormat = options.mode ?? fromPlacement?.format ?? 'modal';
  let launcher: Display | null = null;
  if (format === 'launcher') {
    launcher = display?.format === 'launcher' ? display : null;
    format = launcher?.opens ?? 'modal';
  }
  if (!KNOWN_FORMATS.includes(format)) format = 'modal';
  const source = fromPlacement ?? launcher;
  // The placement's position belongs to its own format: a call that picks another format starts from that format's default.
  const position = options.position ?? source?.position ?? DEFAULT_POSITION[format] ?? 'bottom_right';
  const duration = options.duration ?? fromPlacement?.duration ?? TOAST_SECONDS;
  return { format, position, size: options.size ?? source?.size ?? 'medium', duration };
}

/** A modal, a full screen and a drawer take over the page: backdrop, scroll lock, focus trap. The rest leave it usable. */
const isBlocking = (format: DisplayFormat) => format === 'modal' || format === 'fullscreen' || format === 'drawer';

function frameStyle(layout: Layout): Partial<CSSStyleDeclaration> {
  const base = { position: 'fixed', zIndex: '2147483000', boxSizing: 'border-box' };
  switch (layout.format) {
    case 'modal':
    case 'fullscreen': {
      const modal = layout.format === 'modal';
      return {
        ...base,
        inset: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: modal ? 'rgb(0 0 0 / 0.5)' : 'transparent',
        padding: modal ? '16px' : '0',
      };
    }
    case 'banner':
      return { ...base, left: '0', right: '0', ...(layout.position === 'bottom' ? { bottom: '0' } : { top: '0' }) };
    case 'launcher':
      return base; // never drawn as a screen: layoutOf turns it into what it opens
    case 'drawer':
      return {
        ...base,
        inset: '0',
        display: 'flex',
        justifyContent: layout.position === 'left' ? 'flex-start' : 'flex-end',
        background: 'rgb(0 0 0 / 0.4)',
      };
    case 'toast': {
      const width = `min(${WIDTHS.toast[layout.size]}, calc(100vw - 32px))`;
      const edge =
        layout.position === 'top' ? { top: 'calc(16px + env(safe-area-inset-top, 0px))', left: '0', right: '0', margin: '0 auto' }
        : layout.position === 'corner' ? { bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', right: '16px' }
        : { bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', left: '0', right: '0', margin: '0 auto' };
      return { ...base, width, ...edge };
    }
    case 'slide_in': {
      const width = `min(${WIDTHS.slide_in[layout.size]}, calc(100vw - 32px))`;
      const side =
        layout.position === 'bottom_left' ? { left: '16px' }
        : layout.position === 'bottom_center' ? { left: '0', right: '0', margin: '0 auto' }
        : { right: '16px' };
      return { ...base, bottom: '16px', width, ...side };
    }
  }
}

function panelStyle(layout: Layout, options: PresentOptions): Partial<CSSStyleDeclaration> {
  // zIndex 0 makes the panel its own stacking context, so nothing the screen
  // positions (whatever its z-index) can cover the Close button above it.
  const base = { position: 'relative', zIndex: '0', width: '100%', overflow: 'auto', background: '#fff', outline: 'none', boxSizing: 'border-box' };
  switch (layout.format) {
    case 'modal':
      return {
        ...base,
        height: 'auto',
        maxWidth: options.maxContentWidth ?? WIDTHS.modal[layout.size],
        maxHeight: 'calc(100dvh - 32px)',
        borderRadius: '16px',
        boxShadow: '0 24px 64px rgb(0 0 0 / 0.25)',
      };
    case 'fullscreen':
      return { ...base, height: '100%', maxWidth: 'none', maxHeight: '100dvh', borderRadius: '0', boxShadow: 'none' };
    case 'banner':
      return { ...base, maxHeight: '40vh', boxShadow: layout.position === 'bottom' ? '0 -4px 16px rgb(0 0 0 / 0.12)' : '0 4px 16px rgb(0 0 0 / 0.12)' };
    case 'slide_in':
      return { ...base, maxHeight: 'calc(100dvh - 32px)', borderRadius: '16px', boxShadow: '0 12px 40px rgb(0 0 0 / 0.22)' };
    case 'toast':
      return { ...base, maxHeight: '50dvh', borderRadius: '12px', boxShadow: '0 8px 28px rgb(0 0 0 / 0.2)' };
    case 'drawer':
      return { ...base, width: WIDTHS.drawer[layout.size], maxWidth: '100vw', height: '100%', maxHeight: '100dvh', borderRadius: '0', boxShadow: '-8px 0 32px rgb(0 0 0 / 0.2)' };
    case 'launcher':
      return base; // never drawn as a screen: layoutOf turns it into what it opens
  }
}

/** Internal: lets the auto-placement queue know when a screen actually opened. */
export interface PresentHooks {
  onOpened?(): void;
  /** Opened from a launcher's button: pressing it on purpose is not held back by the frequency cap. */
  ignoreCap?: boolean;
}

/**
 * Shows the paywall over the page and resolves once the user purchases,
 * restores or closes it. Only one paywall is presented at a time; presenting
 * another closes the current one.
 */
export function presentPaywall(options: PresentOptions): Promise<PurchaseResult> {
  return present(options);
}

export async function present(options: PresentOptions, hooks: PresentHooks = {}): Promise<PurchaseResult> {
  options = withDefaults(options);
  const resolved = await resolvePaywall(options.paywall, undefined, { ...targetingInput(options), ignoreCap: hooks.ignoreCap });
  if (resolved.skip) {
    // Targeting chose nothing (cap, audience, holdout): open nothing.
    if (resolved.skip === 'holdout') createTracker(resolved.context)('holdout');
    options.onSkip?.({ reason: resolved.skip });
    return { outcome: 'skipped', reason: resolved.skip };
  }
  const paywall = resolved.paywall;
  closeCurrent?.();

  const layout = layoutOf(options, resolved.display);
  const blocking = isBlocking(layout.format);
  const previousFocus = document.activeElement as HTMLElement | null;
  const previousOverflow = document.documentElement.style.overflow;

  ensureSheet();
  const overlay = document.createElement('div');
  overlay.setAttribute('data-ui-kit-overlay', layout.format);
  if (layout.format !== 'modal' && layout.format !== 'fullscreen') overlay.setAttribute('data-position', layout.position);
  Object.assign(overlay.style, frameStyle(layout));

  const panel = document.createElement('div');
  // A toast is a polite note (read out, no focus taken); every other format is a dialog.
  if (layout.format === 'toast') {
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-label', 'Notice');
  } else {
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', String(blocking));
    panel.setAttribute('aria-label', layout.format === 'drawer' ? 'Details' : blocking ? 'Paywall' : 'Announcement');
  }
  panel.tabIndex = -1;
  Object.assign(panel.style, panelStyle(layout, options));
  overlay.appendChild(panel);

  return new Promise<PurchaseResult>((resolve) => {
    let done = false;
    const focusInside = () => {
      const active = document.activeElement;
      return !!active && (overlay.contains(active) || active === rendered.host);
    };
    // Fade-out of a toast is not the visitor closing anything: no `close` event for it.
    const finish = (result: PurchaseResult, quiet = false) => {
      if (done) return;
      done = true;
      closeCurrent = null;
      currentOverlay = null;
      stopToast();
      document.removeEventListener('keydown', onKeyDown, true);
      if (result.outcome === 'closed' && !quiet) rendered.track('close');
      const answers = rendered.answers();
      // A banner closed while the visitor typed elsewhere must not pull focus back.
      const restoreFocus = blocking || focusInside();
      rendered.destroy();
      overlay.remove();
      if (blocking) document.documentElement.style.overflow = previousOverflow;
      if (restoreFocus) previousFocus?.focus?.();
      if (result.outcome === 'closed') options.onClose?.();
      resolve(withAnswers(result, answers));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!blocking && !focusInside()) return;
        event.preventDefault();
        finish({ outcome: 'closed' });
        return;
      }
      if (event.key !== 'Tab' || !blocking) return;
      const shadow = rendered.host.shadowRoot;
      const items = shadow ? focusableIn(shadow) : [];
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const active = shadow?.activeElement as HTMLElement | null;
      const index = active ? items.indexOf(active) : -1;
      const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index === items.length - 1 ? 0 : index + 1);
      event.preventDefault();
      items[next].focus();
    };

    // The toast leaves by itself after `duration`, but waits while the visitor points at it, reads it
    // with the keyboard, or is on another tab, and never leaves sooner than 2 s after they let go.
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    let toastLeft = layout.duration * 1000;
    let toastStarted = 0;
    function stopToast() {
      if (toastTimer === undefined) return;
      clearTimeout(toastTimer);
      toastTimer = undefined;
      toastLeft = Math.max(toastLeft - (Date.now() - toastStarted), TOAST_MIN_LEFT_MS);
    }
    function startToast() {
      if (layout.format !== 'toast' || done || toastTimer !== undefined) return;
      toastStarted = Date.now();
      toastTimer = setTimeout(() => {
        toastTimer = undefined;
        finish({ outcome: 'closed' }, true);
      }, toastLeft);
    }

    const rendered = renderPaywall(panel, paywall, options, {
      context: resolved.context,
      onClose: () => finish({ outcome: 'closed' }),
      onPurchased: (packageId) => finish({ outcome: 'purchased', packageId }),
      onRestored: () => finish({ outcome: 'restored' }),
      onActioned: (actionId) => finish({ outcome: 'action', actionId }),
    });

    if (blocking) {
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay && (layout.format === 'modal' || layout.format === 'drawer') && options.closeOnBackdrop !== false) finish({ outcome: 'closed' });
      });
      document.documentElement.style.overflow = 'hidden';
    }
    if (layout.format === 'toast') {
      const hold = () => stopToast();
      const release = () => {
        if (!overlay.matches(':hover') && !focusInside()) startToast();
      };
      overlay.addEventListener('pointerenter', hold);
      overlay.addEventListener('pointerleave', release);
      overlay.addEventListener('focusin', hold);
      overlay.addEventListener('focusout', () => setTimeout(release, 0));
      document.addEventListener('visibilitychange', () => (document.hidden ? stopToast() : release()));
    }
    document.addEventListener('keydown', onKeyDown, true);
    document.body.appendChild(overlay);
    // Non-blocking formats never take focus: they must not interrupt typing.
    if (blocking) panel.focus();
    closeCurrent = () => finish({ outcome: 'closed' });
    currentOverlay = overlay;
    startToast();
    hooks.onOpened?.();
  });
}

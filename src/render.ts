import { CustomVariableValue, mountScreen, unmountScreen, type CustomVariables, type ScreenHandle } from '@miniwall/render';
import { buildProductVariables } from './pricing';
import { missingProducts } from './packages';
import { fontsFromPaywall } from './fonts';
import { applyAnswer, chosenOptions, initialSelections, linkedScreens, questionFields, screenLink, type FieldKind } from './flow';
import { resolveScreen } from './load';
import { createTracker, type PaywallContext, type Tracker } from './track';
import type { Answers, PaywallJson, PaywallOptions } from './types';
import { isOpenableUrl } from './url';

/** Lifecycle hooks the presenters use to turn user actions into a result. */
export interface RenderHooks {
  /** Analytics context of the first screen (delivery API sources only). */
  context?: PaywallContext;
  onClose(): void;
  onPurchased(packageId: string): void;
  onRestored(): void;
  /** A custom action finished and was not cancelled by `onAction` returning false. */
  onActioned(actionId: string): void;
}

export interface RenderedPaywall {
  host: HTMLElement;
  /** Records an event for the screen on show now (e.g. `close`). */
  track: Tracker;
  /** Answers collected so far, across every screen of the flow. */
  answers(): Answers;
  destroy(): void;
}

interface Screen {
  paywall: PaywallJson;
  context?: PaywallContext;
  fields: Map<string, FieldKind>;
}

const BUSY_CSS = `
:host { display: block; position: relative; }
.uik-root { position: relative; min-height: 100%; }
.uik-busy { position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
  background: rgb(255 255 255 / 0.6); z-index: 2147483000; }
.uik-root[aria-busy='true'] .uik-busy { display: flex; }
.uik-spinner { width: 32px; height: 32px; border-radius: 50%; border: 3px solid rgb(0 0 0 / 0.15);
  border-top-color: rgb(0 0 0 / 0.6); animation: uik-spin 0.8s linear infinite; }
@keyframes uik-spin { to { transform: rotate(360deg); } }
.uik-screen { outline: none; }
.uik-screen.uik-enter { animation: uik-enter 200ms ease-out; }
@keyframes uik-enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .uik-spinner { animation-duration: 2.4s; }
  .uik-screen.uik-enter { animation: none; }
}
`;

function resolveColorMode(mode: PaywallOptions['colorMode']): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  if (mode === 'system' && typeof matchMedia === 'function') {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function toCustomVariables(values: PaywallOptions['customVariables']): CustomVariables | undefined {
  if (!values) return undefined;
  const out: CustomVariables = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] =
      typeof value === 'number' ? CustomVariableValue.number(value)
      : typeof value === 'boolean' ? CustomVariableValue.boolean(value)
      : CustomVariableValue.string(value);
  }
  return out;
}

function resolveLocale(paywall: PaywallJson, requested?: string): string {
  const available = Object.keys(paywall.components_localizations);
  if (requested) {
    const normalized = requested.replace('-', '_');
    const match = available.find((l) => l === normalized) ?? available.find((l) => l.split('_')[0] === normalized.split('_')[0]);
    if (match) return match;
  }
  return paywall.default_locale;
}

/**
 * Mounts the renderer inside a shadow root appended to `container`. Purchase
 * and restore run through the host's callbacks with a busy overlay, so a
 * double tap can never start two checkouts. "Go to screen" buttons swap the
 * next screen in place (docs/specs/flows-and-questions.md); answers carry
 * across screens.
 */
export function renderPaywall(container: HTMLElement, paywall: PaywallJson, options: PaywallOptions, hooks: RenderHooks): RenderedPaywall {
  const host = document.createElement('div');
  host.setAttribute('data-ui-kit-paywall', '');
  container.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = BUSY_CSS;
  const root = document.createElement('div');
  root.className = 'uik-root';
  const target = document.createElement('div');
  target.className = 'uik-screen';
  target.tabIndex = -1;
  const busy = document.createElement('div');
  busy.className = 'uik-busy';
  busy.setAttribute('role', 'status');
  busy.setAttribute('aria-label', 'Processing');
  busy.innerHTML = '<div class="uik-spinner"></div>';
  root.append(target, busy);
  shadow.append(style, root);

  let isBusy = false;
  const runBusy = async (task: () => Promise<void>) => {
    if (isBusy) return;
    isBusy = true;
    root.setAttribute('aria-busy', 'true');
    target.inert = true;
    try {
      await task();
    } catch (error) {
      options.onError?.(error);
    } finally {
      isBusy = false;
      root.removeAttribute('aria-busy');
      target.inert = false;
    }
  };

  const placement = hooks.context?.placement ?? null;
  const toScreen = (json: PaywallJson, context?: PaywallContext): Screen => ({ paywall: json, context, fields: questionFields(json) });
  let current = toScreen(paywall, hooks.context);
  let track: Tracker = createTracker(current.context);
  const history: Screen[] = [];
  let answers: Answers = {};
  const reported = new Set<string>();
  const loading = new Map<string, Promise<Screen>>();

  /** A linked screen, loaded once; every screen of a flow counts under the flow's placement. */
  const loadScreen = (id: string): Promise<Screen> => {
    let pending = loading.get(id);
    if (!pending) {
      pending = resolveScreen(id, options.screens).then(({ paywall: json, context }) => {
        if (!json) throw new Error(`UIKit: screen ${id} could not be loaded`);
        return toScreen(json, context && { paywallId: context.paywallId, version: context.version, placement });
      });
      // A failed load is retried on the next tap rather than cached.
      pending.catch(() => loading.delete(id));
      loading.set(id, pending);
    }
    return pending;
  };

  /** Counts the options chosen on the current screen, once each, when the visitor moves on. */
  const reportAnswers = () => {
    for (const answer of chosenOptions(answers, current.fields)) {
      const key = `${current.context?.paywallId}|${answer.fieldId}|${answer.optionId}`;
      if (reported.has(key)) continue;
      reported.add(key);
      track('answer', undefined, answer);
    }
  };

  const emit: Tracker = (type, id, answer) => {
    if (type === 'close' || type === 'purchase' || type === 'action' || type === 'restore') reportAnswers();
    track(type, id, answer);
  };

  let component: ScreenHandle | null = null;

  const show = (screen: Screen, animate: boolean) => {
    if (component) {
      try {
        unmountScreen(component);
      } catch {
        // a failed teardown must not block the next screen
      }
    }
    current = screen;
    track = createTracker(screen.context);
    const json = screen.paywall;

    const missing = missingProducts(json, options.products);
    if (missing.length > 0 && !options.variablesPerPackage) {
      console.warn(`[UIKit] No price for package(s) ${missing.join(', ')}. Pass them in \`products\` (keys are the package IDs set in the editor).`);
    }
    const locale = resolveLocale(json, options.locale);
    const computed = options.products ? buildProductVariables(options.products, locale) : {};
    const variablesPerPackage: Record<string, Record<string, string>> = { ...computed };
    for (const [id, vars] of Object.entries(options.variablesPerPackage ?? {})) {
      variablesPerPackage[id] = { ...variablesPerPackage[id], ...vars };
    }

    component = mountScreen(target, {
      paywallData: json as never,
      selectedLocale: locale,
      variablesPerPackage,
      uiConfig: { app: { fonts: fontsFromPaywall(json) } },
      customVariables: toCustomVariables(options.customVariables),
      preferredColorMode: resolveColorMode(options.colorMode),
      showRestoreButton: !!options.onRestore,
      maxContentWidth: options.maxContentWidth,
      initialInputSelections: initialSelections(answers),
      onBackClicked: () => hooks.onClose(),
      onInputChanged: (fieldId: string, value: string) => {
        answers = applyAnswer(answers, current.fields.get(fieldId), fieldId, value);
        options.onAnswer?.({ fieldId, value: answers[fieldId], answers });
      },
      onPurchaseClicked: (packageId: string) =>
        runBusy(async () => {
          if (!options.onPurchase) throw new Error('UIKit: pass onPurchase to handle purchase buttons');
          emit('purchase_click', packageId);
          let ok: boolean | void;
          try {
            ok = await options.onPurchase({ packageId, product: options.products?.[packageId], answers });
          } catch (error) {
            emit('purchase_error', packageId);
            throw error;
          }
          emit(ok === false ? 'purchase_cancel' : 'purchase', packageId);
          if (ok !== false) hooks.onPurchased(packageId);
        }),
      onRestorePurchasesClicked: () =>
        runBusy(async () => {
          const ok = await options.onRestore?.();
          if (ok !== false) {
            emit('restore');
            hooks.onRestored();
          }
        }),
      onActionTriggered: (actionId: string) => {
        const link = screenLink(actionId);
        if (link?.kind === 'back') {
          // The first screen has nowhere to go back to: it closes, like "Close the screen".
          const previous = history.pop();
          if (previous) show(previous, true);
          else hooks.onClose();
          return;
        }
        if (link?.kind === 'goto') {
          void runBusy(async () => {
            const next = await loadScreen(link.id);
            reportAnswers();
            history.push(current);
            show(next, true);
          });
          return;
        }
        void runBusy(async () => {
          // Counted when pressed, whatever the site then does with it.
          emit('action', actionId);
          const ok = await options.onAction?.({ actionId, answers });
          if (ok !== false) hooks.onActioned(actionId);
        });
      },
      onNavigateToUrlClicked: (url: string) => {
        if (!isOpenableUrl(url)) {
          options.onError?.(new Error(`UIKit: not opening "${url.slice(0, 40)}": only http(s), mailto and tel links open`));
          return;
        }
        if (options.onOpenUrl) options.onOpenUrl(url);
        else window.open(url, '_blank', 'noopener,noreferrer');
      },
      onError: (error: unknown) => options.onError?.(error),
    });

    track('view');
    // Load the screens this one links to now, so "Continue" opens them at once.
    for (const id of linkedScreens(json)) loadScreen(id).catch(() => {});

    if (animate) {
      // Start the new screen at its top, with focus inside it (the tapped
      // button is gone), and a short fade unless reduced motion is on.
      container.scrollTop = 0;
      target.classList.remove('uik-enter');
      void target.offsetWidth;
      target.classList.add('uik-enter');
      target.focus({ preventScroll: true });
    }
  };

  show(current, false);

  let destroyed = false;
  return {
    host,
    track: (type, id, answer) => emit(type, id, answer),
    answers: () => answers,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (component) unmountScreen(component);
      host.remove();
    },
  };
}

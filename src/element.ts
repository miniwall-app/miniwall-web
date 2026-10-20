import { configure } from './config';
import { mountPaywall } from './mount';
import type { ColorMode, PaywallHandle, PaywallOptions, PaywallSource, ProductInfo } from './types';

type Callbacks = Pick<PaywallOptions, 'onPurchase' | 'onRestore' | 'onOpenUrl' | 'onAction' | 'onAnswer'>;

const ATTRIBUTES = ['placement', 'paywall-id', 'src', 'api-key', 'api-url', 'locale', 'color-mode', 'max-content-width'] as const;

/**
 * `<uikit-paywall>`: an inline paywall from plain HTML.
 *
 * ```html
 * <uikit-paywall placement="upgrade_button" api-key="pk_..."></uikit-paywall>
 * <script>
 *   const el = document.querySelector('uikit-paywall');
 *   el.products = { annual: { price: 59.99, currency: 'USD', period: 'year' } };
 *   el.onPurchase = async ({ packageId }) => startCheckout(packageId);
 *   el.addEventListener('uikit-purchased', (e) => console.log(e.detail.packageId));
 * </script>
 * ```
 *
 * Source (first set wins): the `paywall` property (JSON or any source), then
 * the `placement`, `paywall-id` or `src` attribute. Events, all bubbling:
 * `uikit-ready`, `uikit-purchased` / `uikit-restored` / `uikit-close`
 * (`detail.packageId` where it applies), `uikit-action` (`detail.actionId`,
 * from a "Run your code" button), `uikit-answer` (`detail.fieldId`,
 * `detail.value`: a question was answered; `detail.answers` holds them all, and
 * is also on purchased/action/close), `uikit-skipped` (`detail.reason`: the
 * placement's targeting showed nothing) and `uikit-error` (`detail.error`).
 */
export interface PaywallElement extends HTMLElement {
  paywall: PaywallSource | undefined;
  products: Record<string, ProductInfo> | undefined;
  customVariables: PaywallOptions['customVariables'];
  visitorAttributes: PaywallOptions['attributes'];
  onPurchase: Callbacks['onPurchase'];
  onRestore: Callbacks['onRestore'];
  onOpenUrl: Callbacks['onOpenUrl'];
  onAction: Callbacks['onAction'];
  onAnswer: Callbacks['onAnswer'];
}

// Built on first use, not at import: `HTMLElement` does not exist during
// server rendering, and this module is part of the SSR-safe entry.
const createElementClass = () =>
  class UIKitPaywallElement extends HTMLElement implements PaywallElement {
    static observedAttributes = [...ATTRIBUTES];

    #paywall: PaywallSource | undefined;
    #products: Record<string, ProductInfo> | undefined;
    #customVariables: PaywallOptions['customVariables'];
    #visitorAttributes: PaywallOptions['attributes'];
    #callbacks: Callbacks = {};
    #handle: PaywallHandle | null = null;
    #renderId = 0;
    #scheduled = false;

    get paywall() {
      return this.#paywall;
    }
    set paywall(value: PaywallSource | undefined) {
      this.#paywall = value;
      this.#schedule();
    }

    get products() {
      return this.#products;
    }
    set products(value: Record<string, ProductInfo> | undefined) {
      this.#products = value;
      this.#schedule();
    }

    /**
     * Visitor attributes for this placement's audiences (merged over
     * `configure`). Not `attributes`: that name belongs to every DOM element.
     */
    get visitorAttributes() {
      return this.#visitorAttributes;
    }
    set visitorAttributes(value: PaywallOptions['attributes']) {
      this.#visitorAttributes = value;
      this.#schedule();
    }

    get customVariables() {
      return this.#customVariables;
    }
    set customVariables(value: PaywallOptions['customVariables']) {
      this.#customVariables = value;
      this.#schedule();
    }

    // Callbacks are read when a button is tapped, so changing them needs no re-render.
    get onPurchase() {
      return this.#callbacks.onPurchase;
    }
    set onPurchase(fn: Callbacks['onPurchase']) {
      this.#callbacks.onPurchase = fn;
    }
    get onRestore() {
      return this.#callbacks.onRestore;
    }
    set onRestore(fn: Callbacks['onRestore']) {
      const hadRestore = !!this.#callbacks.onRestore;
      this.#callbacks.onRestore = fn;
      // The restore button only exists when a handler does.
      if (hadRestore !== !!fn) this.#schedule();
    }
    get onAction() {
      return this.#callbacks.onAction;
    }
    set onAction(fn: Callbacks['onAction']) {
      this.#callbacks.onAction = fn;
    }
    get onAnswer() {
      return this.#callbacks.onAnswer;
    }
    set onAnswer(fn: Callbacks['onAnswer']) {
      this.#callbacks.onAnswer = fn;
    }
    get onOpenUrl() {
      return this.#callbacks.onOpenUrl;
    }
    set onOpenUrl(fn: Callbacks['onOpenUrl']) {
      this.#callbacks.onOpenUrl = fn;
    }

    connectedCallback() {
      if (!this.style.display) this.style.display = 'block';
      this.#schedule();
    }

    disconnectedCallback() {
      this.#renderId++;
      this.#handle?.destroy();
      this.#handle = null;
    }

    attributeChangedCallback() {
      this.#schedule();
    }

    /** Coalesces a burst of attribute/property changes into one render. */
    #schedule() {
      if (this.#scheduled) return;
      this.#scheduled = true;
      queueMicrotask(() => {
        this.#scheduled = false;
        if (this.isConnected) void this.#render();
      });
    }

    #source(): PaywallSource | undefined {
      if (this.#paywall) return this.#paywall;
      const placement = this.getAttribute('placement');
      if (placement) return { placement };
      const paywallId = this.getAttribute('paywall-id');
      if (paywallId) return { paywallId };
      return this.getAttribute('src') ?? undefined;
    }

    #emit(type: string, detail: Record<string, unknown> = {}) {
      this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    }

    async #render() {
      const id = ++this.#renderId;
      const source = this.#source();
      const apiKey = this.getAttribute('api-key');
      if (apiKey)
        configure({
          apiKey,
          ...(this.getAttribute('api-url') ? { apiUrl: this.getAttribute('api-url')! } : {}),
        });
      if (!source) return;

      const callbacks = this.#callbacks;
      try {
        const handle = await mountPaywall(this, {
          paywall: source,
          products: this.#products,
          customVariables: this.#customVariables,
          attributes: this.#visitorAttributes,
          onSkip: ({ reason }) => this.#emit('uikit-skipped', { reason }),
          locale: this.getAttribute('locale') ?? undefined,
          colorMode: (this.getAttribute('color-mode') as ColorMode | null) ?? undefined,
          maxContentWidth: this.getAttribute('max-content-width') ?? undefined,
          onPurchase: async (args) => {
            if (!callbacks.onPurchase) throw new Error('UIKit: set element.onPurchase to handle purchase buttons');
            const ok = await callbacks.onPurchase(args);
            if (ok !== false) this.#emit('uikit-purchased', { packageId: args.packageId, answers: args.answers });
            return ok;
          },
          onRestore: callbacks.onRestore
            ? async () => {
                const ok = await callbacks.onRestore!();
                if (ok !== false) this.#emit('uikit-restored');
                return ok;
              }
            : undefined,
          onOpenUrl: (url) => (callbacks.onOpenUrl ? callbacks.onOpenUrl(url) : window.open(url, '_blank', 'noopener,noreferrer')),
          onAction: async (args) => {
            const ok = await callbacks.onAction?.(args);
            if (ok !== false) this.#emit('uikit-action', { actionId: args.actionId, answers: args.answers });
            return ok;
          },
          onAnswer: (args) => {
            callbacks.onAnswer?.(args);
            this.#emit('uikit-answer', args);
          },
          onClose: () => this.#emit('uikit-close', { answers: this.#handle?.answers() ?? {} }),
          onError: (error) => this.#emit('uikit-error', { error }),
        });
        // A newer render (or removal) started while this one loaded: drop it.
        if (id !== this.#renderId) return handle.destroy();
        this.#handle?.destroy();
        this.#handle = handle;
        if (handle.shown) this.#emit('uikit-ready');
      } catch (error) {
        if (id === this.#renderId) this.#emit('uikit-error', { error });
      }
    }
  };

/**
 * Registers `<uikit-paywall>` (or your own tag name). The `<script>` build
 * calls this for you; with a bundler, call it once. Safe to call twice and
 * during server rendering (it does nothing without `customElements`).
 */
export function definePaywallElement(tagName = 'uikit-paywall'): void {
  if (typeof customElements === 'undefined' || customElements.get(tagName)) return;
  customElements.define(tagName, createElementClass());
}

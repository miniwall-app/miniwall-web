'use client';

import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import type { AutoPlacementsOptions, PaywallHandle, PaywallOptions, PresentOptions, PurchaseResult } from '@miniwall/web';

export type { Answers, AutoPlacementsOptions, PaywallJson, PaywallOptions, PresentOptions, ProductInfo, PurchaseResult } from '@miniwall/web';

// The web SDK is only loaded in the browser, inside effects and event
// handlers, so these components are safe to server-render (Next.js).
const loadSdk = () => import('@miniwall/web');

type CallbackKeys = 'onPurchase' | 'onRestore' | 'onClose' | 'onOpenUrl' | 'onError' | 'onAction' | 'onSkip' | 'onAnswer';

export interface PaywallProps extends PaywallOptions {
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders a paywall inline. Re-renders when `paywall`, `locale`, `colorMode`,
 * `products` or variables change; callbacks always use their latest version
 * without re-rendering the paywall.
 */
export function Paywall({ className, style, ...options }: PaywallProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef<Pick<PaywallOptions, CallbackKeys>>({});
  callbacks.current = {
    onPurchase: options.onPurchase,
    onRestore: options.onRestore,
    onClose: options.onClose,
    onOpenUrl: options.onOpenUrl,
    onError: options.onError,
    onAction: options.onAction,
    onSkip: options.onSkip,
    onAnswer: options.onAnswer,
  };

  const { paywall, locale, colorMode, products, variablesPerPackage, customVariables, maxContentWidth, attributes, screens } = options;
  const dataKey = JSON.stringify({ locale, colorMode, products, variablesPerPackage, customVariables, maxContentWidth, attributes, screens });
  const hasRestore = !!options.onRestore;
  // A placement, paywall ID or URL compares by value, so writing
  // `paywall={{ placement: 'upgrade' }}` inline does not reload (and count a
  // new view) on every render. Full paywall JSON compares by reference:
  // keep it in state or a constant.
  const sourceKey = typeof paywall === 'string' || (paywall && !('components_config' in paywall)) ? JSON.stringify(paywall) : paywall;
  const paywallRef = useRef(paywall);
  paywallRef.current = paywall;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let handle: PaywallHandle | undefined;
    let cancelled = false;
    const data = JSON.parse(dataKey) as Partial<PaywallOptions>;

    loadSdk()
      .then(({ mountPaywall }) =>
        mountPaywall(container, {
          ...data,
          paywall: paywallRef.current,
          onPurchase: (args) => callbacks.current.onPurchase?.(args),
          onRestore: hasRestore ? () => callbacks.current.onRestore?.() : undefined,
          onClose: () => callbacks.current.onClose?.(),
          onAction: (args) => callbacks.current.onAction?.(args),
          onSkip: (args) => callbacks.current.onSkip?.(args),
          onAnswer: (args) => callbacks.current.onAnswer?.(args),
          onOpenUrl: (url) => (callbacks.current.onOpenUrl ? callbacks.current.onOpenUrl(url) : window.open(url, '_blank', 'noopener,noreferrer')),
          onError: (error) => callbacks.current.onError?.(error),
        })
      )
      .then((h) => {
        if (cancelled) h.destroy();
        else handle = h;
      })
      .catch((error) => callbacks.current.onError?.(error));

    return () => {
      cancelled = true;
      handle?.destroy();
    };
  }, [sourceKey, dataKey, hasRestore]);

  return <div ref={containerRef} className={className} style={style} data-ui-kit-container="" />;
}

/**
 * Returns a function that presents a paywall over the page:
 * `const present = usePaywall(); const result = await present({ paywall, onPurchase })`.
 */
export function usePaywall(defaults?: Partial<PresentOptions>): (options: PresentOptions) => Promise<PurchaseResult> {
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  return useCallback(async (options: PresentOptions) => {
    const { presentPaywall } = await loadSdk();
    return presentPaywall({ ...defaultsRef.current, ...options });
  }, []);
}

/**
 * Shows the project's self-triggering placements (page load, delay, scroll,
 * exit intent) while the component is mounted. Options are read when a
 * screen opens, so prices loaded later are used without restarting.
 */
export function useAutoPlacements(options: AutoPlacementsOptions = {}): void {
  // One object the SDK keeps; its fields are swapped for the latest props each render.
  const live = useRef<AutoPlacementsOptions>({});
  for (const key of Object.keys(live.current)) delete live.current[key as keyof AutoPlacementsOptions];
  Object.assign(live.current, options);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void loadSdk().then((sdk) => {
      if (cancelled) return;
      stop = sdk.startAutoPlacements(live.current).stop;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
}

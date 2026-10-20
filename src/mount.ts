import { resolvePaywall, targetingInput } from './load';
import { withDefaults } from './defaults';
import { renderPaywall } from './render';
import { createTracker } from './track';
import type { PaywallHandle, PaywallOptions } from './types';

/**
 * Renders a paywall inline inside `container` (e.g. a pricing section).
 * Purchase/restore/close are reported through the option callbacks only.
 */
export async function mountPaywall(container: HTMLElement, options: PaywallOptions): Promise<PaywallHandle> {
  options = withDefaults(options);
  const resolved = await resolvePaywall(options.paywall, undefined, targetingInput(options));
  if (resolved.skip) {
    // Targeting chose nothing: draw nothing, say why.
    if (resolved.skip === 'holdout') createTracker(resolved.context)('holdout');
    options.onSkip?.({ reason: resolved.skip });
    return { destroy: () => {}, answers: () => ({}), shown: false, skipReason: resolved.skip };
  }
  const paywall = resolved.paywall;
  const rendered: ReturnType<typeof renderPaywall> = renderPaywall(container, paywall, options, {
    context: resolved.context,
    onClose: () => {
      rendered.track('close');
      options.onClose?.();
    },
    onPurchased: () => {},
    onRestored: () => {},
    onActioned: () => {},
  });
  return { destroy: () => rendered.destroy(), answers: () => rendered.answers(), shown: true };
}

# @miniwall/react

React bindings for [`@miniwall/web`](../web): show Miniwall paywalls, onboarding screens and surveys in React and Next.js.

```sh
npm install @miniwall/web @miniwall/react
```

```tsx
import { configure } from '@miniwall/web';
import { Paywall, usePaywall } from '@miniwall/react';

configure({ apiKey: 'pk_...' });

const products = {
  monthly: { price: 9.99, currency: 'USD', period: 'month' },
  annual: { price: 59.99, currency: 'USD', period: 'year' },
} as const;

// Inline, e.g. on a pricing page.
export function Pricing() {
  return <Paywall paywall={{ placement: 'pricing' }} products={products} onPurchase={({ packageId }) => checkout(packageId)} />;
}

// Over the page, from a button.
export function UpgradeButton() {
  const present = usePaywall({ products });
  return (
    <button
      onClick={async () => {
        const result = await present({ paywall: { placement: 'upgrade_button' }, onPurchase: ({ packageId }) => checkout(packageId) });
        if (result.outcome === 'purchased') unlockPro();
      }}
    >
      Upgrade
    </button>
  );
}
```

- Both are safe to server-render: the SDK loads in the browser only (the module is marked `'use client'`).
- `<Paywall>` takes every `@miniwall/web` option. It reloads when the source, `locale`, `colorMode`, `products` or variables change; callbacks always use their latest version without reloading. A placement, paywall ID or URL compares by value, so writing it inline is fine; full paywall JSON compares by reference, so keep it in state or a constant.
- `usePaywall(defaults)` returns `present(options)`, which resolves with the same result as `presentPaywall`.
- `useAutoPlacements(options)` in your root layout shows the placements set to show themselves in the dashboard (page load, delay, scroll, exit intent). Options are read when a screen opens, so prices loaded later are used.

See the [`@miniwall/web` README](../web#readme) for all options, privacy and CSP notes.

## License

MIT

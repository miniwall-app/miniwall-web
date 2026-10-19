# @miniwall/web

Show paywalls, onboarding screens and surveys built in the Miniwall dashboard on any website. The SDK only renders: prices come from your site and checkout stays in your code (Stripe, Paddle, your backend).

- No framework needed. Svelte and the renderer are compiled in.
- Rendered in a shadow root, so your page's CSS does not leak in and the paywall's CSS does not leak out.
- Safe to import during server rendering (Next.js, Remix): nothing touches the DOM until you call it.
- ESM for bundlers, plus one `<script>` file that exposes `window.UIKit` and `<uikit-paywall>`.

React: see [`@miniwall/react`](../web-react).

## Install

```sh
npm install @miniwall/web
```

Or with a script tag (pin the major version):

```html
<script src="https://cdn.jsdelivr.net/npm/@miniwall/web@0/dist/ui-kit.iife.js"></script>
```

## Show a paywall

Get the public key (`pk_...`) from **API keys** in the dashboard, and the placement ID from **Placements**.

```js
import { configure, presentPaywall } from '@miniwall/web';

configure({ apiKey: 'pk_...' });

const result = await presentPaywall({
  paywall: { placement: 'upgrade_button' },
  // Prices from your store, keyed by the package IDs set in the editor.
  products: {
    monthly: { price: 9.99, currency: 'USD', period: 'month' },
    annual: { price: 59.99, currency: 'USD', period: 'year', offer: { price: 0, period: { unit: 'day', count: 7 } } },
  },
  onPurchase: async ({ packageId }) => {
    // Run your checkout. Return true when paid, false when cancelled; throw on failure.
    return startCheckout(packageId);
  },
});
// { outcome: 'purchased', packageId } | { outcome: 'closed' } | { outcome: 'restored' }
// | { outcome: 'action', actionId } | { outcome: 'skipped', reason }
```

Inline, inside your page:

```js
import { mountPaywall } from '@miniwall/web';

const handle = await mountPaywall(document.querySelector('#pricing'), { paywall: { placement: 'pricing' }, products, onPurchase });
handle.destroy();
```

Plain HTML:

```html
<uikit-paywall placement="pricing" api-key="pk_..."></uikit-paywall>
<script>
  const el = document.querySelector('uikit-paywall');
  el.products = { annual: { price: 59.99, currency: 'USD', period: 'year' } };
  el.onPurchase = async ({ packageId }) => startCheckout(packageId);
  el.addEventListener('uikit-purchased', (event) => unlockPro(event.detail.packageId));
</script>
```

## Where the paywall comes from

| `paywall` | Loads |
|---|---|
| `{ placement: 'id' }` | The screen the placement shows now, with its A/B test, schedule and targeting. Recommended. |
| `{ paywallId: 'id' }` | That paywall's published version. |
| `'https://…/paywall.json'` | JSON from any URL (e.g. downloaded from the dashboard and self-hosted). No analytics. |
| a JSON object | That paywall as is. No analytics. |

Published paywalls are cached in the browser and revalidated on each load, so a new publish shows on the next page load, and a paywall still shows when the network is down. A load that takes longer than `timeoutMs` (default 8 s) uses that copy, or fails.

## Options

| Option | |
|---|---|
| `products` | Price of each package: `{ price, currency, period, title?, offer? }`. Fills every `{{ product.* }}` text. `productsFromStripe()` builds it from Stripe prices; `getPackageIds(paywallJson)` lists the IDs a paywall needs. |
| `onPurchase`, `onRestore` | Your checkout and restore. The paywall shows a busy state while they run and ignores double taps. "Restore purchases" only appears when you pass `onRestore`. |
| `onAction` | A "Run your code" button was pressed (onboarding, permission prompts, surveys): `{ actionId, answers }`. Return `false` to keep a presented screen open. |
| `onAnswer` | The visitor answered a question: `{ fieldId, value, answers }`. |
| `onClose`, `onSkip`, `onError` | Closed; targeting chose to show nothing (`frequency_cap`, `audience`, `holdout`); something failed. |
| `onOpenUrl` | Links in the paywall. Default: a new tab. Only `http(s)`, `mailto` and `tel` links are ever opened. |
| `locale`, `colorMode` | e.g. `vi_VN`; `light`, `dark` or `system`. Also settable once in `configure()`. |
| `customVariables` | Values for `{{ custom.name }}` in texts. Shown as plain text, never as HTML. |
| `attributes` | What you know about the visitor (`{ plan: 'free' }`) for placement audiences. Checked in the browser; never sent to Miniwall. `setAttributes()` updates them later. |
| `screens` | For JSON/URL sources: the screens "Go to screen" buttons open, by paywall ID. |
| `mode`, `position`, `size`, `closeOnBackdrop` | `presentPaywall` only. The SDK adds no close button: a screen closes with its own "Close" button (the templates have one), Escape, or a click on a modal's backdrop. `mode`: `modal`, `fullscreen`, `banner` (bar pinned `top`/`bottom`) or `slide_in` (card in a bottom corner, a bottom sheet on phones). Banners and slide-ins leave the page usable. Default: the placement's display from the dashboard, otherwise `modal`. `size` (`small`/`medium`/`large`) sets the width of a modal or slide-in. |

`configure({ apiKey, apiUrl?, locale?, colorMode?, analytics?, attributes?, timeoutMs? })` sets defaults once.

## Screens that show themselves

Placements set to show themselves in the dashboard (on page load, after N seconds, at a scroll depth, or when the visitor is about to leave, on the pages you list) need one call:

```js
UIKit.configure({ apiKey: 'pk_...' });
UIKit.startAutoPlacements({ products, onPurchase, onAction });
```

One screen shows per page view, never over another screen; when several want to show at once the highest priority goes first. Client-side route changes are picked up within a second (call `.refresh()` to re-arm at once, `.stop()` to remove every trigger). React: `useAutoPlacements(options)` from `@miniwall/react`.

## Purchases that finish elsewhere

If checkout redirects away (e.g. Stripe Checkout), call `reportPurchase()` on your success page so the purchase counts for the paywall where the visitor tapped buy:

```js
import { configure, reportPurchase } from '@miniwall/web';
configure({ apiKey: 'pk_...' });
reportPurchase({ packageId: 'annual' });
```

## Privacy and data

- For paywalls loaded by placement or paywall ID, the SDK sends events to the Miniwall API: view, close, purchase tap, purchase, restore, "Run your code" presses and the option IDs chosen in questions. Each carries a random visitor ID kept in `localStorage` (`uikit:vid`), never a user identity. Text typed into questions and your `attributes` are never sent.
- Turn analytics off with `configure({ analytics: false })`. Frequency caps and holdouts still work (they are counted in the browser).
- Keys in `localStorage` (all start with `uikit:`): `uikit:vid`, `uikit:v1:*` (cached paywalls), `uikit:pending-purchase`, `uikit:last-exposure`, `uikit:first-seen` and `uikit:shown:*` (frequency caps), plus `uikit:session-shown:*` in `sessionStorage`. If your cookie banner needs consent for this, call `configure` after consent.

## Content Security Policy

If your site sets a CSP, allow:

- `script-src`: where you load the SDK from (your bundle, or `https://cdn.jsdelivr.net`).
- `style-src 'unsafe-inline'`: the renderer injects its styles into the paywall's shadow root and uses inline styles.
- `connect-src`: the Miniwall API (`https://api.miniwall.app`, or your `apiUrl`).
- `font-src https://cdn.jsdelivr.net`: fonts picked in the editor load from Fontsource on jsDelivr.
- `img-src`: wherever the paywall's images are hosted (Miniwall's image storage, or your own URLs).

## Browser support

Current Chrome, Edge, Firefox and Safari (last two versions), iOS Safari 16+ and Android Chrome. The SDK uses shadow DOM, `crypto.randomUUID`, `AbortController` and `inert`.

## License

MIT. The bundles include Svelte and other open-source code: see `dist/THIRD_PARTY_LICENSES.md`.

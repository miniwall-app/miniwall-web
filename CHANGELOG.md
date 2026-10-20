# Changelog

## Unreleased

- The ES bundle (`dist/index.js`) now holds only the SDK's own code (about 65 KB, readable) and imports the screen renderer from the new `@miniwall/render` dependency, which ships compiled. Your bundler installs it with the SDK; you do not need Svelte. The `<script>` build is unchanged: it still bundles everything. Exports are unchanged.
- The default `apiUrl` is now `https://api.miniwall.app` (was `https://json-ui-kit-api.vercel.app`, which keeps answering, so installed versions are unaffected). If your Content-Security-Policy lists the old host in `connect-src`, add `https://api.miniwall.app`, or keep passing `apiUrl` to stay on the old host.

- New formats for `presentPaywall`: `mode: 'banner'` (`position: 'top' | 'bottom'`) and `mode: 'slide_in'` (`position: 'bottom_right' | 'bottom_left' | 'bottom_center'`, a bottom sheet on phones), plus `size` for modals and slide-ins. Without `mode`, a placement uses the display set in the dashboard. Additive: existing calls behave as before.
- `startAutoPlacements()`: placements show themselves on page load, after a delay, at a scroll depth or on exit intent, on the pages listed in the dashboard; one screen per page view, by priority.

## 0.1.0

First public release.

- `presentPaywall`, `mountPaywall`, `loadPaywall`, `<uikit-paywall>` (`definePaywallElement`) and the `<script>` build (`window.UIKit`).
- Sources: placement, paywall ID, URL or JSON. Published paywalls are cached and revalidated by ETag, and shown from the cache when the network fails or is slower than `timeoutMs` (default 8 s).
- Placements: A/B tests, schedules, audiences, frequency caps and holdouts; `attributes` / `setAttributes` stay in the browser.
- Multi-screen flows ("Go to screen", "Back") and questions (`answers`, `onAnswer`); "Run your code" buttons (`onAction`).
- Prices from your site: `products`, `buildProductVariables`, `productsFromStripe`, `getPackageIds`.
- Analytics events (views, closes, purchase taps, purchases, actions, chosen answers) with `reportPurchase` for purchases that finish elsewhere; `configure({ analytics: false })` turns them off.
- Security: paywall texts are escaped before their markdown becomes HTML, and only `http(s)`, `mailto` and `tel` links are opened.

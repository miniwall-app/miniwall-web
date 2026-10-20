# Releasing @miniwall/web and @miniwall/react

Not published with the package (`files` in package.json).

## Before the first release (people, not the AI team)

- [ ] **npm scope**: the `miniwall` organization on npm exists and you can publish `@miniwall/render`, `@miniwall/web` and `@miniwall/react`. Names cannot be taken back once people install them.
- [ ] **Copyright holder** in `LICENSE` (now "Miniwall"): put the legal name of the person or company.
- [ ] **Production API**: `DEFAULT_API_URL` in `src/config.ts` (`https://api.miniwall.app`, a custom domain that stays ours) must answer `/v1/sdk/...` for real keys. Every site that does not pass `apiUrl` talks to it, so it must be a domain we keep.
- [ ] **npm access**: an npm account with 2FA and publish rights.
- [ ] **`@miniwall/render` is published first** (the maintainers do it); this package depends on its exact version.

## Each release

1. Bump `version` in `package.json` and `react/package.json` (semver; 0.x: a minor bump may break), and `version` in `src/index.ts` (a test checks they match). Add a `CHANGELOG.md` entry to each. `dependencies["@miniwall/render"]` is the exact version it was tested with.
2. `pnpm typecheck && pnpm test && pnpm test:e2e` green.
3. Check what ships: `pnpm pack` (then `tar tzf` the file): `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`, `dist/THIRD_PARTY_LICENSES.md`, `dist/RENDERER_LICENSE`. `pnpm check:pack` fails on a source map or on renderer code inlined in the ES bundle.
4. Publish with pnpm (it turns `workspace:^` into a real version range; `prepublishOnly` refuses any other tool), `@miniwall/web` first:
   ```sh
   pnpm --filter @miniwall/web publish
   pnpm --filter @miniwall/react publish
   ```
5. After the first release the `<script>` build is also served from the CDN: `https://cdn.jsdelivr.net/npm/@miniwall/web@0/dist/ui-kit.iife.js`.

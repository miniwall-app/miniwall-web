# Releasing @miniwall/web and @miniwall/react

Not published with the package (`files` in package.json). `0.1.0` was released on 2026-10-20 with the steps below.

A release is a tag. Pushing a tag `X.Y.Z` (or `X.Y.Z-rc.N`) on `main` runs `.github/workflows/release.yml`, which publishes both packages to npm. Nothing is published unless the repository variable `PUBLISH_ENABLED` is `true` and the repository secret `NPM_TOKEN` exists.

## Each release

1. Bump `version` in `package.json` and `react/package.json` (semver; 0.x: a minor bump may break), and `version` in `src/index.ts` (a test checks they match). Add a `## X.Y.Z` section to both `CHANGELOG.md` files (the workflow refuses a tag without one). `dependencies["@miniwall/render"]` is the exact version this package was tested with and it **must already be on npm**; run `pnpm install` and commit `pnpm-lock.yaml` (the workflow installs with a frozen lockfile).
2. `pnpm typecheck && pnpm test && pnpm test:e2e` green (CI runs the same on every push). `pnpm check:pack` fails on a source map, on renderer code inlined in the ES bundle, or on an unminified `<script>` build.
3. Merge to `main`, then tag that commit and push **only that tag** (never `git push --tags`, it pushes every local tag at once):
   ```sh
   git tag -a X.Y.Z -m "X.Y.Z" && git push origin X.Y.Z
   ```
4. The workflow checks the tag first (it sits on `main`, matches every version in the repository, has a changelog section, and the pinned `@miniwall/render` exists), then installs, tests, and publishes `@miniwall/web` and then `@miniwall/react`. A version that is already on npm is skipped, so re-running after a partial failure is safe. A prerelease tag (`X.Y.Z-rc.N`) is published under the `next` dist-tag, never `latest`. It also creates the GitHub release if there is none for the tag.
5. Check: `npm view @miniwall/web version` and `npm view @miniwall/react version`. npm can take a few minutes to show a new package page after a publish; the tarball is available sooner.
6. The `<script>` build is also served from the CDN: `https://cdn.jsdelivr.net/npm/@miniwall/web@0/dist/ui-kit.iife.js`.

## Publishing without the workflow

Publish with pnpm (it turns `workspace:^` into a real version range; `prepublishOnly` refuses any other tool), `@miniwall/web` first:

```sh
pnpm --filter @miniwall/web publish
pnpm --filter @miniwall/react publish
```

## Setup notes

- **Token:** the first publish of a package needs a granular npm token (read and write on the `@miniwall` scope, allowed to publish without a one-time code), because npm cannot attach a trusted publisher to a package that does not exist yet. Now that the packages exist, set up trusted publishing for both and remove the token.
- **Provenance:** npm only issues provenance for public repositories. The workflow publishes without `--provenance` while this repository is private; add it back once the repository is public.
- **Copyright holder** in `LICENSE`: it ends up in every published version, so change it before a release, not after.
- **Production API:** `DEFAULT_API_URL` in `src/config.ts` (`https://api.miniwall.app`, a domain that stays ours) must answer `/v1/sdk/...` for real keys. Every site that does not pass `apiUrl` talks to it.

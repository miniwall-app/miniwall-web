// Fails if the npm tarball would ship source maps, a stray monorepo path, the renderer inlined in the ES bundle, or an
// unminified browser bundle. Run after `pnpm build`: part of `prepublishOnly` and `test:e2e`.
// The checks are about the shape of the bundles (size, line length, imports), not about names inside the renderer.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' }));
// The ES bundle holds only this SDK (about 65 KB). The renderer (about 125 KB more) is a dependency, so a bundle this big means it was inlined.
const ES_MAX_BYTES = 120_000;
// The browser bundle is minified: a few long lines. Unminified code averages well under 100 characters per line.
const IIFE_MIN_AVG_LINE = 500;
const problems = [];
const paths = pack.files.map((f) => f.path);
for (const required of ['dist/index.js', 'dist/ui-kit.iife.js', 'dist/THIRD_PARTY_LICENSES.md', 'dist/RENDERER_LICENSE', 'LICENSE']) {
  if (!paths.includes(required)) problems.push(`${required}: missing from the package`);
}
for (const { path } of pack.files) {
  if (/\.map$/.test(path)) problems.push(`${path}: source map in the package`);
  if (!/\.(js|mjs|cjs)$/.test(path)) continue;
  const text = readFileSync(path, 'utf8');
  if (text.includes('sourceMappingURL')) problems.push(`${path}: points at a source map`);
  if (/(^|[^\w.-])packages\/[\w-]+\//.test(text)) problems.push(`${path}: mentions a monorepo path`);
  // The ES bundle is only this SDK: the renderer is a dependency, not inlined. The IIFE carries the renderer, so it must be minified.
  if (path === 'dist/index.js') {
    if (!/from\s*["']@miniwall\/render["']/.test(text)) problems.push(`${path}: does not import @miniwall/render`);
    if (text.length > ES_MAX_BYTES) problems.push(`${path}: ${text.length} bytes, over ${ES_MAX_BYTES}: the renderer looks inlined`);
    if (/from\s*["']svelte/.test(text)) problems.push(`${path}: imports svelte (the renderer carries its own runtime)`);
  }
  if (path === 'dist/ui-kit.iife.js') {
    const avgLine = text.length / Math.max(1, text.split('\n').length);
    if (avgLine < IIFE_MIN_AVG_LINE) problems.push(`${path}: not minified (average line ${Math.round(avgLine)} characters)`);
  }
}
if (problems.length) {
  console.error(`Package contents check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Package contents ok (${pack.files.length} files, no source maps)`);

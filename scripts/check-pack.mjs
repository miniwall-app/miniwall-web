// Fails if the npm tarball would ship source maps or any trace of the private renderer source (packages/ui-sdk).
// Run after `pnpm build`: part of `prepublishOnly` and `test:e2e`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' }));
// Internal function names of the private renderer (packages/ui-sdk): they must not survive in the shipped bundles.
const RENDERER_INTERNALS = ['getPackageInfoContext', 'getColorModeContext', 'createInputChoiceContext', 'getSelectedStateContext', 'getInitialInputSelectionsContext'];
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
  if (text.includes('packages/ui-sdk')) problems.push(`${path}: mentions packages/ui-sdk`);
  // The ES bundle is only this SDK: the renderer is a dependency, not inlined. The IIFE carries the renderer, so it must be minified.
  if (path === 'dist/index.js') {
    if (!/from\s*["']@miniwall\/render["']/.test(text)) problems.push(`${path}: does not import @miniwall/render`);
    const inlined = RENDERER_INTERNALS.filter((name) => text.includes(name));
    if (inlined.length) problems.push(`${path}: renderer code inlined (${inlined.join(', ')})`);
    if (/from\s*["']svelte/.test(text)) problems.push(`${path}: imports svelte (the renderer carries its own runtime)`);
  }
  if (path === 'dist/ui-kit.iife.js') {
    const readable = RENDERER_INTERNALS.filter((name) => text.includes(name));
    if (readable.length) problems.push(`${path}: not minified (readable renderer names: ${readable.join(', ')})`);
  }
}
if (problems.length) {
  console.error(`Package contents check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Package contents ok (${pack.files.length} files, no source maps)`);

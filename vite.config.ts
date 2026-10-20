import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const require = createRequire(import.meta.url);

// Two bundles from one entry:
//  - ESM (dist/index.js) for bundlers. It is only this SDK's own code: the renderer is a dependency (@miniwall/render, compiled,
//    with Svelte inside), so the host never needs Svelte and there is exactly one copy of the runtime.
//  - IIFE (dist/ui-kit.iife.js) for a plain <script> tag; bundles the renderer too, exposes `window.UIKit` and registers
//    <uikit-paywall>.
// The renderer injects its component CSS at runtime into the paywall's shadow root, so there is no stylesheet to import.
export default defineConfig(({ mode }) => {
  const iife = mode === 'iife';
  return {
    plugins: [
      {
        // The IIFE carries the renderer and what it bundles (Svelte...): their licenses ship with it.
        name: 'third-party-licenses',
        generateBundle() {
          if (!iife) return;
          this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_LICENSES.md', source: readFileSync(require.resolve('@miniwall/render/THIRD_PARTY_LICENSES.md')) });
          this.emitFile({ type: 'asset', fileName: 'RENDERER_LICENSE', source: readFileSync(require.resolve('@miniwall/render/LICENSE')) });
        },
      },
    ],
    build: {
      emptyOutDir: !iife,
      // No source maps: the IIFE would embed the renderer's compiled code map. `pnpm check:pack` guards this.
      sourcemap: false,
      lib: {
        entry: iife ? 'src/iife.ts' : 'src/index.ts',
        formats: iife ? ['iife'] : ['es'],
        name: 'UIKit',
        fileName: () => (iife ? 'ui-kit.iife.js' : 'index.js'),
      },
      // The ES bundle is readable (bundlers minify it); the IIFE is minified and carries the compiled renderer.
      minify: iife,
      rolldownOptions: iife
        ? { output: { postBanner: `/*! @miniwall/web ${version} | MIT (the SDK) | includes the compiled @miniwall/render: RENDERER_LICENSE | third-party licenses: THIRD_PARTY_LICENSES.md */` } }
        : { external: ['@miniwall/render'] },
    },
    test: {
      environment: 'jsdom',
      include: ['tests/**/*.test.ts'],
      setupFiles: ['tests/setup.ts'],
    },
  };
});

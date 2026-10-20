// @vitest-environment node
import { describe, expect, it } from 'vitest';

describe('server rendering', () => {
  it('imports without a DOM, and defining the element is a no-op', async () => {
    const sdk = await import('../src');
    expect(() => sdk.definePaywallElement()).not.toThrow();
    expect(typeof sdk.mountPaywall).toBe('function');
    // A cold import compiles the whole SDK (Svelte included); under the full
    // parallel QC run with coverage that can take longer than the 5 s default.
  }, 30_000);
});

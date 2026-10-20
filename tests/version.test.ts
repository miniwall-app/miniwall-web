import { describe, expect, it } from 'vitest';
import pkg from '../package.json';
import { version } from '../src';

describe('version', () => {
  it('matches package.json, so a release never reports an old version', () => {
    expect(version).toBe(pkg.version);
  });
});

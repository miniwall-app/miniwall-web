import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sample from './fixtures/sample-paywall.json';
import { configure, setAttributes } from '../src';
import { bucketOf, resolvePaywall, targetingInput } from '../src/load';
import { settings } from '../src/config';
import { firstMatch, isCapped, matches, recordShown } from '../src/targeting';
import { createTracker, flush, reportPurchase, visitorId } from '../src/track';

const screen = (paywallId: string) => ({ placement: 'upgrade', paywallId, version: 1, paywall: sample });
const input = (attributes: Record<string, string | number | boolean> = {}, locale?: string) => ({ attributes, locale });

let fetchMock: ReturnType<typeof vi.fn>;
let apiUrl = 0;

function deliver(extra: Record<string, unknown>) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...screen('default'), experiment: null, ...extra }), { status: 200 }));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  configure({ apiKey: 'pk_test', apiUrl: `https://targeting${++apiUrl}.example.com`, attributes: undefined });
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete settings.attributes;
});

describe('conditions', () => {
  it('compares text without case, numbers as numbers, and presence', () => {
    expect(matches({ field: 'user.plan', op: 'eq', value: 'PRO' }, 'pro')).toBe(true);
    expect(matches({ field: 'user.plan', op: 'neq', value: 'pro' }, undefined)).toBe(true);
    expect(matches({ field: 'locale', op: 'starts_with', value: 'vi' }, 'vi-VN')).toBe(true);
    expect(matches({ field: 'path', op: 'contains', value: '/pricing' }, '/en/pricing/team')).toBe(true);
    expect(matches({ field: 'user.days', op: 'gte', value: 7 }, '10')).toBe(true);
    expect(matches({ field: 'user.days', op: 'lt', value: 7 }, 'ten')).toBe(false);
    expect(matches({ field: 'user.trial', op: 'eq', value: 'true' }, true)).toBe(true);
    expect(matches({ field: 'user.email', op: 'exists' }, '')).toBe(false);
    expect(matches({ field: 'user.email', op: 'not_exists' }, null)).toBe(true);
  });

  it('picks the first audience whose conditions all hold', () => {
    const rules = [
      { id: 'a', conditions: [{ field: 'user.plan', op: 'eq' as const, value: 'pro' }, { field: 'user.country', op: 'eq' as const, value: 'VN' }] },
      { id: 'b', conditions: [{ field: 'user.plan', op: 'eq' as const, value: 'pro' }] },
    ];
    expect(firstMatch(rules, { placement: 'p', ...input({ plan: 'pro', country: 'US' }) })?.id).toBe('b');
    expect(firstMatch(rules, { placement: 'p', ...input({ plan: 'pro', country: 'VN' }) })?.id).toBe('a');
    expect(firstMatch(rules, { placement: 'p', ...input({ plan: 'free' }) })).toBeUndefined();
  });
});

describe('frequency cap', () => {
  it('counts views per placement within the period', () => {
    const now = Date.UTC(2026, 8, 28, 12);
    recordShown('upgrade', now - 2 * 86_400_000); // two days ago
    recordShown('upgrade', now - 1000);
    expect(isCapped('upgrade', { max: 2, per: 'day' }, now)).toBe(false);
    expect(isCapped('upgrade', { max: 2, per: 'week' }, now)).toBe(true);
    expect(isCapped('upgrade', { max: 2, per: 'ever' }, now)).toBe(true);
    expect(isCapped('upgrade', { max: 3, per: 'session' }, now)).toBe(false);
    expect(isCapped('other', { max: 1, per: 'ever' }, now)).toBe(false);
    expect(isCapped('upgrade', null, now)).toBe(false);
  });
});

describe('placement targeting in resolvePaywall', () => {
  const paidNothing = { id: 'paid', conditions: [{ field: 'user.plan', op: 'eq', value: 'pro' }], paywall: null };
  const vietnamese = { id: 'vi', conditions: [{ field: 'locale', op: 'starts_with', value: 'vi' }], paywall: screen('vietnamese') };

  it('shows nothing to an audience set to Nothing, and the matching screen to others', async () => {
    deliver({ rules: [paidNothing, vietnamese] });
    expect(await resolvePaywall({ placement: 'upgrade' }, undefined, input({ plan: 'pro' }, 'vi_VN'))).toEqual({ skip: 'audience' });
    deliver({ rules: [paidNothing, vietnamese] });
    const vi = await resolvePaywall({ placement: 'upgrade' }, undefined, input({ plan: 'free' }, 'vi_VN'));
    expect(vi.context?.paywallId).toBe('vietnamese');
    deliver({ rules: [paidNothing, vietnamese] });
    const en = await resolvePaywall({ placement: 'upgrade' }, undefined, input({ plan: 'free' }, 'en_US'));
    expect(en.context?.paywallId).toBe('default');
  });

  it('uses configure/setAttributes attributes, with per-call ones on top', () => {
    configure({ attributes: { plan: 'free', country: 'VN' } });
    setAttributes({ plan: 'pro', country: null });
    expect(targetingInput({ attributes: { beta: true } }).attributes).toEqual({ plan: 'pro', beta: true });
  });

  it('skips once the frequency cap is reached', async () => {
    recordShown('upgrade');
    deliver({ frequency: { max: 1, per: 'day' } });
    expect(await resolvePaywall({ placement: 'upgrade' }, undefined, input())).toEqual({ skip: 'frequency_cap' });
  });

  it('holds out a stable share of visitors, keeping the screen they would have seen', async () => {
    const id = `${visitorId()}-test`;
    const heldOut = bucketOf(`holdout:${id}`, visitorId()) < 50;
    deliver({ holdout: { id, share: 50 } });
    const first = await resolvePaywall({ placement: 'upgrade' }, undefined, input());
    deliver({ holdout: { id, share: 50 } });
    const again = await resolvePaywall({ placement: 'upgrade' }, undefined, input());
    expect(first.skip === 'holdout').toBe(heldOut);
    expect(again.skip).toBe(first.skip);
    expect(first.context?.paywallId).toBe('default');
  });

  it('loadPaywall-style calls without targeting ignore the rules', async () => {
    deliver({ rules: [paidNothing], frequency: { max: 1, per: 'ever' } });
    recordShown('upgrade');
    const resolved = await resolvePaywall({ placement: 'upgrade' });
    expect(resolved.paywall).toBeTruthy();
  });
});

describe('holdout analytics', () => {
  it('sends a holdout event and credits a later reportPurchase() to the holdout group', () => {
    const sent = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', sent);
    const track = createTracker({ paywallId: 'p1', version: 2, placement: 'upgrade' });
    track('holdout');
    flush();
    reportPurchase({ packageId: 'annual' });
    const events = sent.mock.calls.flatMap(([, init]) => JSON.parse(init.body).events);
    expect(events.map((e: { type: string }) => e.type)).toEqual(['holdout', 'holdout_purchase']);
    expect(events[1]).toMatchObject({ paywallId: 'p1', placement: 'upgrade', packageId: 'annual' });
  });

  it('credits a purchase without a buy tap to the placement the visitor saw', () => {
    const sent = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', sent);
    createTracker({ paywallId: 'p1', placement: 'upgrade' })('view');
    flush();
    reportPurchase();
    const events = sent.mock.calls.flatMap(([, init]) => JSON.parse(init.body).events);
    expect(events.map((e: { type: string }) => e.type)).toEqual(['view', 'purchase']);
  });
});

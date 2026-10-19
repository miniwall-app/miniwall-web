import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { Paywall, usePaywall } from '../src';

const mountPaywall = vi.fn();
const presentPaywall = vi.fn();
vi.mock('@miniwall/web', () => ({ mountPaywall: (...a: unknown[]) => mountPaywall(...a), presentPaywall: (...a: unknown[]) => presentPaywall(...a) }));

const paywall = { default_locale: 'en_US', components_config: { base: {} }, components_localizations: {} };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<Paywall>', () => {
  it('server-renders an empty container without touching the SDK', () => {
    expect(renderToString(<Paywall paywall={paywall} />)).toContain('data-ui-kit-container');
    expect(mountPaywall).not.toHaveBeenCalled();
  });

  it('mounts into its container and destroys on unmount', async () => {
    const destroy = vi.fn();
    mountPaywall.mockResolvedValue({ destroy });
    const { container, unmount } = render(<Paywall paywall={paywall} locale="vi_VN" />);
    await waitFor(() => expect(mountPaywall).toHaveBeenCalledOnce());
    expect(mountPaywall.mock.calls[0][0]).toBe(container.firstChild);
    expect(mountPaywall.mock.calls[0][1]).toMatchObject({ paywall, locale: 'vi_VN' });
    unmount();
    await waitFor(() => expect(destroy).toHaveBeenCalledOnce());
  });

  it('uses the latest callback without remounting', async () => {
    mountPaywall.mockResolvedValue({ destroy: vi.fn() });
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Paywall paywall={paywall} onPurchase={first} />);
    await waitFor(() => expect(mountPaywall).toHaveBeenCalledOnce());
    rerender(<Paywall paywall={paywall} onPurchase={second} />);
    await mountPaywall.mock.calls[0][1].onPurchase({ packageId: 'annual' });
    expect(second).toHaveBeenCalledWith({ packageId: 'annual' });
    expect(first).not.toHaveBeenCalled();
    expect(mountPaywall).toHaveBeenCalledOnce();
  });

  it('does not remount for an inline placement written again on each render', async () => {
    mountPaywall.mockResolvedValue({ destroy: vi.fn() });
    const { rerender } = render(<Paywall paywall={{ placement: 'upgrade' }} />);
    await waitFor(() => expect(mountPaywall).toHaveBeenCalledOnce());
    rerender(<Paywall paywall={{ placement: 'upgrade' }} />);
    rerender(<Paywall paywall={{ placement: 'upgrade' }} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(mountPaywall).toHaveBeenCalledOnce();
    rerender(<Paywall paywall={{ placement: 'onboarding' }} />);
    await waitFor(() => expect(mountPaywall).toHaveBeenCalledTimes(2));
  });

  it('remounts when the locale changes', async () => {
    const destroy = vi.fn();
    mountPaywall.mockResolvedValue({ destroy });
    const { rerender } = render(<Paywall paywall={paywall} locale="en_US" />);
    await waitFor(() => expect(mountPaywall).toHaveBeenCalledTimes(1));
    rerender(<Paywall paywall={paywall} locale="vi_VN" />);
    await waitFor(() => expect(mountPaywall).toHaveBeenCalledTimes(2));
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe('usePaywall', () => {
  it('presents with defaults merged under call options', async () => {
    presentPaywall.mockResolvedValue({ outcome: 'closed' });
    let present!: ReturnType<typeof usePaywall>;
    function Probe() {
      present = usePaywall({ locale: 'vi_VN', mode: 'fullscreen' });
      return null;
    }
    render(<Probe />);
    await expect(present({ paywall, mode: 'modal' })).resolves.toEqual({ outcome: 'closed' });
    expect(presentPaywall).toHaveBeenCalledWith({ locale: 'vi_VN', mode: 'modal', paywall });
  });
});

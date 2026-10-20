/**
 * The launcher: a floating button that opens a screen when pressed. It is not a screen
 * itself, so it neither takes the page's one screen nor blocks other triggers; it sits
 * under every screen (z-index) and is hidden while the screen it opened is up.
 */
import type { DisplaySize } from './types';

export interface LauncherOptions {
  label: string;
  position: 'bottom_left' | 'bottom_right';
  size?: DisplaySize;
  onPress(): void;
}

export interface LauncherHandle {
  /** Shows the button again after its screen closed, with focus back on it. */
  restore(): void;
  hide(): void;
  destroy(): void;
}

const SHEET_ID = 'uik-launcher-css';
const SHEET = `
@keyframes uik-launcher-in { from { opacity: 0; } }
[data-ui-kit-launcher] { animation: uik-launcher-in 200ms ease-out; }
[data-ui-kit-launcher]:focus-visible { outline: 2px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 4px #18181b, 0 8px 24px rgb(0 0 0 / 0.28) !important; }
@media (prefers-reduced-motion: reduce) { [data-ui-kit-launcher] { animation: none !important; } }
`;

export function mountLauncher(options: LauncherOptions): LauncherHandle {
  if (!document.getElementById(SHEET_ID)) {
    const style = document.createElement('style');
    style.id = SHEET_ID;
    style.textContent = SHEET;
    document.head.appendChild(style);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-ui-kit-launcher', options.position);
  button.setAttribute('aria-haspopup', 'dialog');
  button.textContent = options.label;
  Object.assign(button.style, {
    position: 'fixed',
    zIndex: '2147482000', // under every screen (2147483000)
    bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
    [options.position === 'bottom_left' ? 'left' : 'right']: '16px',
    height: '48px',
    maxWidth: 'calc(100vw - 32px)',
    padding: '0 20px',
    border: '0',
    borderRadius: '999px',
    background: '#18181b',
    color: '#fff',
    font: '600 15px/1 system-ui, -apple-system, "Segoe UI", sans-serif',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgb(0 0 0 / 0.28)',
  } satisfies Partial<CSSStyleDeclaration> & Record<string, string>);
  button.addEventListener('click', () => options.onPress());
  document.body.appendChild(button);

  return {
    restore() {
      if (!button.isConnected) document.body.appendChild(button);
      button.style.display = '';
      button.focus({ preventScroll: true });
    },
    hide() {
      button.style.display = 'none';
    },
    destroy() {
      button.remove();
    },
  };
}

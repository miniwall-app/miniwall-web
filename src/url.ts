/**
 * Whether a link from a paywall may be opened: web pages, email and phone
 * links only. A `javascript:` or `data:` URL in a paywall's JSON would run on
 * the host page, so it is never opened or handed to `onOpenUrl`.
 */
export function isOpenableUrl(url: string): boolean {
  // Browsers ignore whitespace and control characters (code <= 32, 127) in a scheme.
  const plain = Array.from(url)
    .filter((char) => char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127)
    .join('')
    .toLowerCase();
  return /^(https?:|mailto:|tel:)/.test(plain) || /^\/(?!\/)/.test(plain);
}

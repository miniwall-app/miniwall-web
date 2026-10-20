/**
 * Placements that show themselves (docs/specs/display-and-triggers.md): on
 * page load, after a delay, at a scroll depth or on exit intent, on the pages
 * the dashboard lists. One screen per page view, never over another screen,
 * and when several fire at once the highest priority goes first.
 */
import { fetchAutoPlacements, resolvePaywall, targetingInput, type AutoPlacement } from './load';
import { mountLauncher, type LauncherHandle } from './launcher';
import { isPresenting, present } from './present';
import type { AutoPlacementsHandle, AutoPlacementsOptions, Trigger } from './types';

const ROUTE_POLL_MS = 1000;

/** Drops trailing slashes with a plain loop: a regex like `/\/+$/` is quadratic on a long run of slashes. */
const trimSlash = (path: string) => {
  let end = path.length;
  while (end > 1 && path.charCodeAt(end - 1) === 47) end--;
  return end === path.length ? path : path.slice(0, end);
};

/**
 * `*` matches any run of characters (slashes included); everything else is literal. Linear in the
 * path (no regex, so a pattern full of `*` cannot make the visitor's browser grind): the first piece
 * must open the path, the last must close it, the pieces between are found in order.
 */
function globMatches(pattern: string, path: string): boolean {
  const parts = pattern.split('*');
  if (parts.length === 1) return pattern === path;
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (path.length < first.length + last.length || !path.startsWith(first) || !path.endsWith(last)) return false;
  let at = first.length;
  const stop = path.length - last.length;
  for (let i = 1; i < parts.length - 1; i++) {
    const found = path.indexOf(parts[i], at);
    if (found === -1 || found + parts[i].length > stop) return false;
    at = found + parts[i].length;
  }
  return true;
}

/** `/blog/*` style patterns against a pathname; no patterns = every page. */
export function matchesPage(patterns: string[] | undefined, pathname: string): boolean {
  if (!patterns?.length) return true;
  const path = trimSlash(pathname);
  return patterns.some((pattern) => globMatches(trimSlash(pattern), path));
}

/** Exit intent needs a mouse leaving the window: phones and tablets never fire it. */
function isTouchOnly(): boolean {
  if (typeof matchMedia === 'function') return matchMedia('(hover: none)').matches;
  return (navigator.maxTouchPoints ?? 0) > 0;
}

/** Arms one trigger; `fire` runs at most once. Returns the cleanup. */
function arm(trigger: Trigger, fire: () => void): () => void {
  let fired = false;
  const once = () => {
    if (fired) return;
    fired = true;
    cleanup();
    fire();
  };
  const cleanups: (() => void)[] = [];
  const cleanup = () => cleanups.splice(0).forEach((c) => c());

  switch (trigger.type) {
    case 'page_load': {
      if (document.readyState === 'complete') {
        const id = setTimeout(once, 0);
        cleanups.push(() => clearTimeout(id));
      } else {
        window.addEventListener('load', once, { once: true });
        cleanups.push(() => window.removeEventListener('load', once));
      }
      break;
    }
    case 'delay': {
      const id = setTimeout(once, Math.max(0, trigger.seconds ?? 0) * 1000);
      cleanups.push(() => clearTimeout(id));
      break;
    }
    case 'scroll': {
      const check = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const percent = max <= 0 ? 100 : (window.scrollY / max) * 100;
        if (percent >= (trigger.percent ?? 100)) once();
      };
      window.addEventListener('scroll', check, { passive: true });
      cleanups.push(() => window.removeEventListener('scroll', check));
      const id = setTimeout(check, 0);
      cleanups.push(() => clearTimeout(id));
      break;
    }
    case 'exit_intent': {
      if (isTouchOnly()) break;
      const onOut = (event: MouseEvent) => {
        if (!event.relatedTarget && event.clientY <= 0) once();
      };
      document.addEventListener('mouseout', onOut);
      cleanups.push(() => document.removeEventListener('mouseout', onOut));
      break;
    }
    default:
      break;
  }
  return cleanup;
}

let active: AutoPlacementsHandle | null = null;

/**
 * Shows the project's self-triggering placements on this page. Call once,
 * after `configure({ apiKey })`. Takes the same callbacks as presentPaywall.
 */
export function startAutoPlacements(options: AutoPlacementsOptions = {}): AutoPlacementsHandle {
  if (active) return active;
  if (typeof window === 'undefined') return { refresh() {}, stop() {} };

  let list: AutoPlacement[] | null = null;
  let stopped = false;
  let shownOnPage = false;
  let path = location.pathname;
  let disarms: (() => void)[] = [];
  let pending: AutoPlacement[] = [];
  let draining = false;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  // One launcher button per page; it is not a screen and does not take the page's one screen.
  let launcher: LauncherHandle | null = null;
  let launcherChecking = false;

  /** Shows the first pending placement that targeting lets through. */
  const drain = async () => {
    drainTimer = null;
    if (draining) return;
    draining = true;
    while (pending.length && !stopped) {
      const next = pending.shift()!;
      if (shownOnPage || isPresenting()) continue;
      // Read at fire time: the site may have loaded its prices since start.
      const { onResult, ...presentOptions } = options;
      await new Promise<void>((settle) => {
        present({ ...presentOptions, paywall: { placement: next.placement } }, {
          onOpened() {
            shownOnPage = true;
            settle();
          },
        })
          .then((result) => onResult?.({ placement: next.placement, result }))
          .catch((error) => options.onError?.(error))
          .finally(settle);
      });
      if (shownOnPage) pending = [];
    }
    draining = false;
  };

  // Fires in the same moment (two page_load triggers) are collected first, so
  // priority decides rather than whichever listener ran first.
  const enqueue = (placement: AutoPlacement) => {
    if (stopped || !list) return;
    pending.push(placement);
    pending.sort((a, b) => list!.indexOf(a) - list!.indexOf(b));
    drainTimer ??= setTimeout(() => void drain(), 0);
  };

  /** The launcher's button appears when audience and holdout allow the screen; its frequency cap counts when it is pressed. */
  const showLauncher = (placement: AutoPlacement) => {
    const display = placement.display;
    if (stopped || launcher || launcherChecking || display?.format !== 'launcher' || !display.label) return;
    launcherChecking = true;
    const { onResult, ...presentOptions } = options;
    resolvePaywall({ placement: placement.placement }, undefined, { ...targetingInput(options), ignoreCap: true })
      .then((resolved) => {
        if (stopped || launcher || resolved.skip) return;
        launcher = mountLauncher({
          label: display.label!,
          position: display.position === 'bottom_left' ? 'bottom_left' : 'bottom_right',
          onPress() {
            launcher?.hide();
            present({ ...presentOptions, paywall: { placement: placement.placement }, mode: 'launcher' }, { ignoreCap: true })
              .then((result) => onResult?.({ placement: placement.placement, result }))
              .catch((error) => options.onError?.(error))
              .finally(() => launcher?.restore());
          },
        });
      })
      .catch((error) => options.onError?.(error))
      .finally(() => {
        launcherChecking = false;
      });
  };

  const disarmAll = () => {
    launcher?.destroy();
    launcher = null;
    disarms.splice(0).forEach((d) => d());
    pending = [];
    if (drainTimer) clearTimeout(drainTimer);
    drainTimer = null;
  };

  /** A new page view: fresh triggers for the pages that match. */
  const armPage = () => {
    disarmAll();
    shownOnPage = false;
    path = location.pathname;
    for (const placement of list ?? []) {
      if (placement.trigger.type === 'manual' || !matchesPage(placement.trigger.pages, path)) continue;
      disarms.push(arm(placement.trigger, () => (placement.display?.format === 'launcher' ? showLauncher(placement) : enqueue(placement))));
    }
  };

  const onRoute = () => {
    if (location.pathname !== path) armPage();
  };
  window.addEventListener('popstate', onRoute);
  const poll = setInterval(onRoute, ROUTE_POLL_MS);

  fetchAutoPlacements()
    .then((placements) => {
      if (stopped) return;
      list = placements;
      armPage();
    })
    .catch((error) => options.onError?.(error));

  const handle: AutoPlacementsHandle = {
    refresh() {
      if (!stopped && list) armPage();
    },
    stop() {
      stopped = true;
      disarmAll();
      clearInterval(poll);
      window.removeEventListener('popstate', onRoute);
      if (active === handle) active = null;
    },
  };
  active = handle;
  return handle;
}

import { DEFAULT_SPACE, SLUG_RE } from '@agora/shared';
import { world } from './net/client';

/**
 * URL routes (P2.3, P2.4, P2.15): `/s/:slug` is a space, `/join/:token` a space invite
 * link (pilot modes), `/join#…`, `/setup#…` and `/recover#…` account links (passkey mode;
 * the secret is in the fragment so it never reaches the server's logs).
 */
export type Route =
  | { kind: 'space'; slug: string }
  | { kind: 'join'; token: string }
  | { kind: 'ticket'; token: string };

const LAST = 'agora.space';

export function lastSpace(): string {
  try {
    const s = localStorage.getItem(LAST);
    return s && SLUG_RE.test(s) ? s : DEFAULT_SPACE;
  } catch {
    return DEFAULT_SPACE;
  }
}

export function rememberSpace(slug: string) {
  try {
    localStorage.setItem(LAST, slug);
  } catch {
    /* private mode */
  }
}

let cached: Route | null = null;

/** Current route; `/` and unknown paths become the last space visited (URL rewritten). */
export function currentRoute(): Route {
  // computed once: the first call removes a link's secret from the address bar
  return (cached ??= readRoute());
}

function readRoute(): Route {
  const parts = location.pathname.split('/').filter(Boolean);
  const fragment = location.hash.slice(1);
  if (['join', 'setup', 'recover'].includes(parts[0] ?? '') && !parts[1] && fragment) {
    // keep the secret out of the address bar, history and screenshots from now on
    history.replaceState(null, '', location.pathname);
    return { kind: 'ticket', token: decodeURIComponent(fragment) };
  }
  if (parts[0] === 'join' && parts[1]) return { kind: 'join', token: decodeURIComponent(parts[1]) };
  if (parts[0] === 's' && parts[1] && SLUG_RE.test(parts[1]))
    return { kind: 'space', slug: parts[1] };
  const slug = lastSpace();
  history.replaceState(null, '', `/s/${slug}${location.search}`);
  return { kind: 'space', slug };
}

/** Leave this space for another one (a full page load resets the world and media). */
export function goToSpace(slug: string) {
  rememberSpace(slug);
  world.leave();
  location.assign(`/s/${encodeURIComponent(slug)}`);
}

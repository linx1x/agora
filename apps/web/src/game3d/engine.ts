/**
 * Which world view this device draws (P16.6, ADR-052). 2.5D needs the server's `world25d` flag
 * and this device's choice: `?view=2.5d` (or `?view=2d`), or the saved choice in
 * `localStorage['agora.worldView']`. Build mode is still 2D (its 3D editing is P16.13), so it
 * takes the 2D view while it is on. Pure, so every combination is unit-tested.
 */
export type WorldEngine = '2d' | '2.5d';

export const VIEW_KEY = 'agora.worldView';
const VIEW_PARAM = 'view';

function asEngine(v: string | null | undefined): WorldEngine | null {
  return v === '2.5d' || v === '2d' ? v : null;
}

export function chooseEngine(
  flags: { world25d?: boolean } | undefined,
  search: string,
  stored: string | null,
  building: boolean,
): WorldEngine {
  if (flags?.world25d !== true || building) return '2d';
  const asked = asEngine(new URLSearchParams(search).get(VIEW_PARAM)) ?? asEngine(stored);
  return asked === '2.5d' ? '2.5d' : '2d';
}

/** The stored choice, or null when storage is blocked or empty. */
export function readStoredView(): string | null {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
}

/** `?view=` wins and is saved for the next visit (P16.11 adds the Settings control). */
export function rememberViewFromUrl(search: string): void {
  const asked = asEngine(new URLSearchParams(search).get(VIEW_PARAM));
  if (!asked) return;
  try {
    localStorage.setItem(VIEW_KEY, asked);
  } catch {
    // storage blocked (private window): the URL still works for this visit
  }
}

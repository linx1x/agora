import { useSyncExternalStore } from 'react';
import { useStore } from '../state/store';

/**
 * Compact layout (P8.2): phones, small tablets and short landscape screens get a
 * single-row dock, a "More" sheet and the side panel as a sheet. App sets the
 * `.app.compact` / `.app.touch` classes that styles.css keys its phone rules on.
 */
export const COMPACT_QUERY =
  '(max-width: 760px), (max-height: 500px), (pointer: coarse) and (max-width: 1024px)';
/** In the compact layout, the people/chat panel is a bottom sheet (over the joystick). */
export const BOTTOM_SHEET_QUERY = '(orientation: portrait) and (max-width: 599px)';
/** Touch is the main pointer: show the joystick, tap (not press) to move, pinch to zoom. */
export const TOUCH_QUERY = '(pointer: coarse)';

export function matches(q: string): boolean {
  try {
    return window.matchMedia(q).matches;
  } catch {
    return false;
  }
}

function subscribe(q: string) {
  return (cb: () => void) => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(q);
    } catch {
      return () => {};
    }
    mq.addEventListener('change', cb);
    return () => mq.removeEventListener('change', cb);
  };
}
const subs = new Map<string, (cb: () => void) => () => void>();
export function useMedia(q: string): boolean {
  let s = subs.get(q);
  if (!s) subs.set(q, (s = subscribe(q)));
  return useSyncExternalStore(s, () => matches(q));
}

export const useCompact = () => useMedia(COMPACT_QUERY);
export const useTouch = () => useMedia(TOUCH_QUERY);

/** Flag `touchControls` (P8.2) turns the compact layout and the touch controls off. */
const useTouchFlag = () => useStore((s) => s.config?.flags.touchControls !== false);
export function useCompactLayout(): boolean {
  const on = useCompact();
  return useTouchFlag() && on;
}
export function useTouchControls(): boolean {
  const on = useTouch();
  return useTouchFlag() && on;
}

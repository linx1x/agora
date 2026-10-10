import { test } from '@playwright/test';

/**
 * The world view a test runs in (P16.12). `playwright.config.ts` has a `2.5d` project that runs the
 * specs written for both views (world, mobile, media) in the 2.5D view; the `2d` project runs them
 * in the flat view, as before. Call it inside a test or a hook, where `test.info()` is available.
 */
export function runView(): '2d' | '2.5d' {
  return test.info().project.name === '2.5d' ? '2.5d' : '2d';
}

/**
 * A 2.5D run pins the hour (`?hour=`): that turns off the device probe, which would otherwise see
 * the software GPU of a test machine and switch the device to 2D (P16.11). Use it as the `goto` path.
 */
export function entryPath(view: '2d' | '2.5d'): string {
  return view === '2.5d' ? '/?hour=13' : '/';
}

/**
 * P16.8 (ADR-052): the pure parts of the 2.5D overlays (names, status dots, emotes and speech
 * bubbles above people and characters), kept free of the DOM so they are unit-tested.
 *
 * The numbers and rules were the former flat view's (WorldScene for people, NpcsView for
 * characters, removed in P16.20), kept so the 2.5D view says the same things in the same places. Offsets are CSS px
 * above the head point; the DOM in `overlays.ts` applies them as `bottom` on each row.
 */

/** chat lines longer than this are cut (the former flat `onMessage`) */
export const CHAT_LIMIT = 90;
/** a character's line is cut at this length (the former `NpcsView.say`) */
export const LINE_LIMIT = 180;
/** nearby chat stays this long (the former flat `onMessage`), in ms */
export const CHAT_MS = 5000;

/** gap between the head point and the label's bottom edge (2D label origin, -AV_H - 2) */
export const GAP_LABEL = 2;
/** gap between the label's top edge and the bubble's bottom edge */
export const GAP_BUBBLE = 4;
/** gap between the bubble's top edge and the emote's bottom edge */
export const GAP_EMOTE_BUBBLE = 4;
/** gap between the label's top edge and the emote's bottom edge, when no bubble shows */
export const GAP_EMOTE = 2;

/** the status dot colours of the 2D view (`STATUS_COLOR`), as CSS; unknown statuses are green */
const STATUS_CSS = new Map<string, string>([
  ['available', '#2f7d5b'],
  ['busy', '#f2a900'],
  ['dnd', '#c2364b'],
  ['away', '#9aa6b1'],
]);
const DEFAULT_STATUS = '#2f7d5b';

/**
 * Cuts a line the way the 2D view does: over `limit` characters it keeps the first `limit - 2`
 * and adds "…" (90 becomes 88 + "…"). It never splits a surrogate pair, so an emoji is not left
 * half-drawn at the cut.
 */
export function clipBubble(text: string, limit = CHAT_LIMIT): string {
  if (text.length <= limit) return text;
  let end = limit - 2;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

/**
 * How long a character's line stays up, in ms: 70 ms a character, between 4 s and 12 s
 * (the former `NpcsView.say`). `length` is the length of the full line, before any cut.
 */
export function lineMs(length: number): number {
  return Math.min(12000, Math.max(4000, length * 70));
}

/**
 * The three dots a character shows while it writes: one, two, three, cycling every 350 ms.
 * Under reduced motion it is always three, still. The dots are padded with no-break spaces so
 * the bubble keeps its width (and stays centred) as the count changes.
 */
export function typingDots(now: number, reduced: boolean): string {
  const n = reduced ? 3 : 1 + (Math.floor(now / 350) % 3);
  return '·'.repeat(n).padEnd(3, ' ');
}

/** The status dot colour as CSS; unknown or missing statuses are green, as in the 2D view. */
export function statusColor(status?: string): string {
  return (status !== undefined && STATUS_CSS.get(status)) || DEFAULT_STATUS;
}

/** The label text: the name, or "<name> · <botWord>" for a character (i18n `npc.bot`). */
export function labelText(info: { name: string; bot?: boolean }, botWord: string): string {
  return info.bot ? `${info.name} · ${botWord}` : info.name;
}

export interface StackHeights {
  label: number;
  bubble: number;
  emote: number;
}
export interface StackShown {
  bubble: boolean;
  emote: boolean;
}
/** Offsets in px above the head point, to each row's bottom edge. A hidden row gets 0. */
export interface StackOffsets {
  label: number;
  bubble: number;
  emote: number;
}

/**
 * Stacks the rows above the head point: the label just above the head, the bubble above the
 * label, and the emote above the bubble when it shows (above the label when it does not).
 * Whole px, so the text stays on the pixel grid.
 */
export function stack(heights: StackHeights, shown: StackShown): StackOffsets {
  const label = GAP_LABEL;
  let top = label + heights.label;
  let bubble = 0;
  if (shown.bubble) {
    bubble = top + GAP_BUBBLE;
    top = bubble + heights.bubble;
  }
  let emote = 0;
  if (shown.emote) emote = top + (shown.bubble ? GAP_EMOTE_BUBBLE : GAP_EMOTE);
  return { label: Math.round(label), bubble: Math.round(bubble), emote: Math.round(emote) };
}

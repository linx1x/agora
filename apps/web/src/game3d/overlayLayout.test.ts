import { describe, expect, it } from 'vitest';
import {
  CHAT_LIMIT,
  GAP_BUBBLE,
  GAP_EMOTE,
  GAP_EMOTE_BUBBLE,
  GAP_LABEL,
  LINE_LIMIT,
  clipBubble,
  labelText,
  lineMs,
  stack,
  statusColor,
  typingDots,
} from './overlayLayout';

describe('overlay text (P16.8)', () => {
  it('cuts chat over 90 characters to 88 and an ellipsis, like the 2D view', () => {
    expect(clipBubble('a'.repeat(90))).toBe('a'.repeat(90));
    expect(clipBubble('a'.repeat(91))).toBe(`${'a'.repeat(88)}…`);
    expect(clipBubble('short')).toBe('short');
    expect(clipBubble('a'.repeat(91), CHAT_LIMIT)).toHaveLength(89);
  });

  it('uses the character limit (180 → 178 + …) when asked', () => {
    expect(clipBubble('x'.repeat(LINE_LIMIT), LINE_LIMIT)).toBe('x'.repeat(LINE_LIMIT));
    expect(clipBubble('x'.repeat(LINE_LIMIT + 1), LINE_LIMIT)).toBe(`${'x'.repeat(178)}…`);
  });

  it('does not split an emoji at the cut', () => {
    // 87 letters then an emoji (two UTF-16 units) straddling the 88-unit cut
    const text = `${'a'.repeat(87)}😀${'b'.repeat(5)}`;
    expect(clipBubble(text)).toBe(`${'a'.repeat(87)}…`);
  });

  it('lays out typing dots: 1, 2, 3 cycling every 350 ms, stable width, still when reduced', () => {
    expect(typingDots(0, false)).toBe('·  ');
    expect(typingDots(349, false)).toBe('·  ');
    expect(typingDots(350, false)).toBe('·· ');
    expect(typingDots(700, false)).toBe('···');
    expect(typingDots(1050, false)).toBe('·  ');
    for (const t of [0, 350, 700, 1234]) expect(typingDots(t, true)).toBe('···');
  });

  it('holds a character line for 70 ms a character, between 4 s and 12 s', () => {
    expect(lineMs(0)).toBe(4000);
    expect(lineMs(100)).toBe(7000);
    expect(lineMs(1000)).toBe(12000);
  });

  it('labels people with their name and characters with "· Bot"', () => {
    expect(labelText({ name: 'Ada' }, 'Bot')).toBe('Ada');
    expect(labelText({ name: 'Ada', bot: false }, 'Bot')).toBe('Ada');
    expect(labelText({ name: 'Guide', bot: true }, 'Bot')).toBe('Guide · Bot');
  });

  it('colours the status dot as the 2D view does, green by default', () => {
    expect(statusColor('available')).toBe('#2f7d5b');
    expect(statusColor('busy')).toBe('#f2a900');
    expect(statusColor('dnd')).toBe('#c2364b');
    expect(statusColor('away')).toBe('#9aa6b1');
    expect(statusColor('mystery')).toBe('#2f7d5b');
    expect(statusColor(undefined)).toBe('#2f7d5b');
    expect(statusColor('toString')).toBe('#2f7d5b');
  });
});

describe('overlay stacking (P16.8)', () => {
  const heights = { label: 16, bubble: 20, emote: 24 };

  it('puts only the label above the head when nothing else shows', () => {
    expect(stack(heights, { bubble: false, emote: false })).toEqual({
      label: GAP_LABEL,
      bubble: 0,
      emote: 0,
    });
  });

  it('puts the emote above the label when there is no bubble', () => {
    const off = stack(heights, { bubble: false, emote: true });
    expect(off.emote).toBe(GAP_LABEL + heights.label + GAP_EMOTE);
    expect(off.bubble).toBe(0);
  });

  it('puts the bubble above the label', () => {
    const off = stack(heights, { bubble: true, emote: false });
    expect(off.bubble).toBe(GAP_LABEL + heights.label + GAP_BUBBLE);
    expect(off.emote).toBe(0);
  });

  it('puts the emote above the bubble when both show', () => {
    const off = stack(heights, { bubble: true, emote: true });
    const bubbleTop = off.bubble + heights.bubble;
    expect(off.emote).toBe(bubbleTop + GAP_EMOTE_BUBBLE);
    expect(off.emote).toBeGreaterThan(off.bubble);
  });

  it('matches the 2D numbers for a 16 px label (bubble 6 + label above the head)', () => {
    // the former NpcsView: bubble bottom at -AV_H - 6 - label.height, emote at -AV_H - 10 - label - bubble
    expect(stack(heights, { bubble: true, emote: false }).bubble).toBe(6 + 16);
    expect(stack(heights, { bubble: true, emote: true }).emote).toBe(10 + 16 + 20);
  });

  it('rounds to whole px', () => {
    const off = stack({ label: 15.4, bubble: 20.6, emote: 19.2 }, { bubble: true, emote: true });
    for (const v of Object.values(off)) expect(Number.isInteger(v)).toBe(true);
  });
});

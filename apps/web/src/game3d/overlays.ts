/**
 * P16.8 (ADR-052): names, status dots, emotes and speech bubbles over people and characters in the
 * 2.5D view, as screen-space HTML so they stay crisp at every zoom.
 *
 * The former flat view drew the same things with Phaser text (WorldScene and NpcsView, removed in
 * P16.20, ADR-054); the rules and numbers were copied from there, and the pure parts live in
 * `overlayLayout.ts`.
 *
 * DOM, one block per id, inside one `.ov25` container that is aria-hidden (the People panel is
 * the accessible list):
 *   .ov25-who                0×0 box at the head point, moved with transform: translate3d
 *     .ov25-row (label)      400 px wide, `bottom` = its offset above the head
 *       .ov25-label          name; people get a status dot, characters "<name> · Bot" on teal
 *     .ov25-row (bubble)     chat, a character's line, or three dots while it writes
 *     .ov25-row (emote)      an emote glyph; the raised hand while it is up
 *
 * Per-frame writes are cached. A frame writes a transform only when the head point moves by a
 * whole px, and text, colour and opacity only when they change. Row offsets are measured and
 * written only when a row appears, goes, or its text changes, so 50 people cost a few reads, not
 * a layout per frame.
 *
 * Stacking order: the container is inserted before World3DView's fade div (the fade is that
 * view's last child), so the fade covers the names too. Text is never scaled, so it is the same
 * CSS-px size at every zoom, like the 2D labels at zoom 1.
 */
import { EMOTE_GLYPH, EMOTE_MS } from '@agora/shared';
import i18n from '../i18n';
import {
  CHAT_LIMIT,
  CHAT_MS,
  LINE_LIMIT,
  clipBubble,
  labelText,
  lineMs,
  stack,
  statusColor,
  typingDots,
  type StackOffsets,
} from './overlayLayout';

export interface OverlayInfo {
  name: string;
  /** a person's status (`available`, `busy`, `away`, …); characters have none */
  status?: string;
  /** characters: the label reads "<name> · Bot" (i18n `npc.bot`) */
  bot?: boolean;
  online: boolean;
  /** raised hand shows the ✋ glyph until lowered */
  hand: boolean;
  /** seated: the 2D view lifts the overlay 5 px less; kept for parity, may be ignored */
  sitting?: boolean;
}

/** what the bubble shows: a line that was said, three dots while writing, or nothing */
type BubbleKind = '' | 'say' | 'dots';

interface Slot {
  who: HTMLDivElement;
  labelRow: HTMLDivElement;
  label: HTMLDivElement;
  dot: HTMLSpanElement;
  name: HTMLSpanElement;
  bubbleRow: HTMLDivElement;
  bubble: HTMLDivElement;
  emoteRow: HTMLDivElement;
  emote: HTMLDivElement;

  /** has a head point this frame (`at` was not null) */
  placed: boolean;
  /** last whole-px translate written */
  x: number;
  y: number;
  labelText: string;
  bot: boolean;
  dotColor: string;
  offline: boolean;
  bubbleKind: BubbleKind;
  /** text currently in the bubble ('' when hidden) */
  bubbleText: string;
  /** text currently in the emote row ('' when hidden) */
  emoteText: string;
  /** the last line said (clipped), kept for texts(true) */
  said: string;
  saidNow: boolean;
  sayUntil: number;
  typing: boolean;
  /** the last emote glyph sent, kept for texts(true) */
  glyph: string;
  glyphUntil: number;
  hand: boolean;
  /** last offsets written as `bottom`, NaN until the first write */
  off: StackOffsets;
  /** rows appeared, went or changed height: measure and restack on the next placed frame */
  dirty: boolean;
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

export class Overlays {
  private readonly root: HTMLDivElement;
  private readonly slots = new Map<string, Slot>();
  private readonly reduceQuery: MediaQueryList | undefined;

  constructor(parent: HTMLElement) {
    this.root = parent.ownerDocument.createElement('div');
    this.root.className = 'ov25';
    this.root.setAttribute('aria-hidden', 'true');
    // World3DView appends its fade div last; insert before it so the fade covers the overlay too
    parent.insertBefore(this.root, parent.lastElementChild);
    this.reduceQuery = window.matchMedia?.(REDUCED_QUERY);
  }

  /** Each frame: where `id`'s head is on screen (CSS px inside `parent`), or null to hide it. */
  sync(id: string, info: OverlayInfo, at: { x: number; y: number } | null, now: number): void {
    const s = this.slotFor(id);
    const reduced = this.reduceQuery?.matches === true;

    // who: name, bot tag, status dot, offline fade (written only when they change)
    const bot = info.bot === true;
    if (bot !== s.bot) {
      s.bot = bot;
      s.label.classList.toggle('ov25-label--bot', bot);
      s.dot.hidden = bot;
      s.dirty = true;
    }
    const text = labelText(info, bot ? i18n.t('npc.bot') : '');
    if (text !== s.labelText) {
      s.labelText = text;
      s.name.textContent = text;
      s.dirty = true;
    }
    const dotColor = statusColor(info.status);
    if (dotColor !== s.dotColor) {
      s.dotColor = dotColor;
      s.dot.style.background = dotColor;
    }
    const offline = !info.online;
    if (offline !== s.offline) {
      s.offline = offline;
      s.who.style.opacity = offline ? '0.5' : '';
    }
    s.hand = info.hand;

    // bubble: a line that was said wins over the three dots; dots show while typing
    const saying = now < s.sayUntil;
    const kind: BubbleKind = saying ? 'say' : s.typing ? 'dots' : '';
    const bubbleText = kind === 'say' ? s.said : kind === 'dots' ? typingDots(now, reduced) : '';
    s.saidNow = saying;
    if (kind !== s.bubbleKind || (kind === 'say' && bubbleText !== s.bubbleText)) s.dirty = true;
    if (bubbleText !== s.bubbleText) {
      s.bubbleText = bubbleText;
      s.bubble.textContent = bubbleText;
    }
    if (kind !== s.bubbleKind) {
      s.bubbleKind = kind;
      s.bubbleRow.hidden = kind === '';
    }

    // emote: the raised hand until lowered, else the last glyph for EMOTE_MS
    const glyph = info.hand ? EMOTE_GLYPH.hand : now < s.glyphUntil ? s.glyph : '';
    if (glyph !== s.emoteText) {
      const toggled = (s.emoteText === '') !== (glyph === '');
      s.emoteText = glyph;
      s.emote.textContent = glyph;
      if (toggled) s.emoteRow.hidden = glyph === '';
      s.dirty = true;
    }

    if (at === null || !Number.isFinite(at.x) || !Number.isFinite(at.y)) {
      if (s.placed) {
        s.placed = false;
        s.who.hidden = true;
      }
      return;
    }

    // place: whole px, and only when the head point moved
    if (!s.placed) {
      s.placed = true;
      s.who.hidden = false;
      s.dirty = true;
    }
    const rx = Math.round(at.x);
    const ry = Math.round(at.y);
    if (rx !== s.x || ry !== s.y) {
      s.x = rx;
      s.y = ry;
      s.who.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    }

    // stack: measure the rows that are up, then write their offsets if they moved
    if (s.dirty) {
      s.dirty = false;
      const off = stack(
        {
          label: s.labelRow.offsetHeight,
          bubble: s.bubbleKind === '' ? 0 : s.bubbleRow.offsetHeight,
          emote: s.emoteText === '' ? 0 : s.emoteRow.offsetHeight,
        },
        { bubble: s.bubbleKind !== '', emote: s.emoteText !== '' },
      );
      if (off.label !== s.off.label) {
        s.off.label = off.label;
        s.labelRow.style.bottom = `${off.label}px`;
      }
      if (off.bubble !== s.off.bubble) {
        s.off.bubble = off.bubble;
        s.bubbleRow.style.bottom = `${off.bubble}px`;
      }
      if (off.emote !== s.off.emote) {
        s.off.emote = off.emote;
        s.emoteRow.style.bottom = `${off.emote}px`;
      }
    }
  }

  /** Show an emote glyph for EMOTE_MS. */
  emote(id: string, glyph: string, now: number): void {
    const s = this.slotFor(id);
    s.glyph = glyph;
    s.glyphUntil = now + EMOTE_MS;
  }

  /**
   * Show a speech bubble (nearby chat, a character's line) for `ms`. Chat is cut at 90 characters;
   * a character's line at 180, and it stays up for `lineMs` by default (chat: 5 s).
   */
  say(id: string, text: string, now: number, ms?: number): void {
    if (!text) return;
    const s = this.slotFor(id);
    s.said = clipBubble(text, s.bot ? LINE_LIMIT : CHAT_LIMIT);
    s.sayUntil = now + (ms ?? (s.bot ? lineMs(text.length) : CHAT_MS));
    s.typing = false;
  }

  /** A character is writing: three dots (still under reduced motion) until it speaks or stops. */
  typing(id: string, on: boolean): void {
    this.slotFor(id).typing = on;
  }

  /** Remove every overlay whose id is not in `ids`. */
  keep(ids: Set<string>): void {
    for (const [id, s] of this.slots) {
      if (ids.has(id)) continue;
      s.who.remove();
      this.slots.delete(id);
    }
  }

  /** Texts shown (names, bubbles, emotes); all = including hidden ones. */
  texts(all = false): string[] {
    const out: string[] = [];
    for (const s of this.slots.values()) {
      if (!all && !s.placed) continue;
      if (s.labelText) out.push(s.labelText);
      if (s.said && (all || s.saidNow)) out.push(s.said);
      const glyph = all ? (s.hand ? EMOTE_GLYPH.hand : s.glyph) : s.emoteText;
      if (glyph) out.push(glyph);
    }
    return out;
  }

  destroy(): void {
    this.root.remove();
    this.slots.clear();
  }

  private slotFor(id: string): Slot {
    let s = this.slots.get(id);
    if (!s) {
      s = this.build();
      this.slots.set(id, s);
    }
    return s;
  }

  /** The DOM for one id. Nothing is shown until a sync places it. */
  private build(): Slot {
    const doc = this.root.ownerDocument;
    const el = <K extends 'div' | 'span'>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
      const node = doc.createElement(tag);
      node.className = cls;
      return node;
    };
    const who = el('div', 'ov25-who');
    who.hidden = true;
    const labelRow = el('div', 'ov25-row ov25-row--label');
    const label = el('div', 'ov25-label');
    const dot = el('span', 'ov25-dot');
    const name = el('span', 'ov25-name');
    label.append(dot, name);
    labelRow.append(label);
    const bubbleRow = el('div', 'ov25-row ov25-row--bubble');
    bubbleRow.hidden = true;
    const bubble = el('div', 'ov25-bubble');
    bubbleRow.append(bubble);
    const emoteRow = el('div', 'ov25-row ov25-row--emote');
    emoteRow.hidden = true;
    const emote = el('div', 'ov25-emote');
    emoteRow.append(emote);
    who.append(labelRow, bubbleRow, emoteRow);
    this.root.append(who);
    return {
      who,
      labelRow,
      label,
      dot,
      name,
      bubbleRow,
      bubble,
      emoteRow,
      emote,
      placed: false,
      x: Number.NaN,
      y: Number.NaN,
      labelText: '',
      bot: false,
      dotColor: '',
      offline: false,
      bubbleKind: '',
      bubbleText: '',
      emoteText: '',
      said: '',
      saidNow: false,
      sayUntil: 0,
      typing: false,
      glyph: '',
      glyphUntil: 0,
      hand: false,
      off: { label: Number.NaN, bubble: Number.NaN, emote: Number.NaN },
      dirty: true,
    };
  }
}

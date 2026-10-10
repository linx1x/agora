/**
 * Draws the characters the server describes in `npc:state` (ADR-042, P15.2). Browsers decide
 * nothing: a character is an avatar that eases toward the last position it was sent, with its
 * name and a "Bot" tag so nobody mistakes it for a colleague.
 */
import Phaser from 'phaser';
import { EMOTE_GLYPH, EMOTE_MS, type Avatar, type NpcEmote, type NpcState } from '@agora/shared';
import i18n from '../i18n';
import { store } from '../state/store';
import { AV_H } from './avatars';

/** Per second; the server sends about 15 updates a second, this smooths the gaps. */
const EASE = 14;
const SNAP_PX = 96;
const WALK_SEQ = [1, 0, 3, 2];
const D_OVERLAY = 100000;

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

interface View {
  body: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  over: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  /** a wave over its head (P15.3), shown for EMOTE_MS */
  emote: Phaser.GameObjects.Text;
  emoteUntil: number;
  /** what it said (P15.4), and the "…" while it is writing */
  bubble: Phaser.GameObjects.Text;
  bubbleUntil: number;
  typing: boolean;
  goal: NpcState;
  x: number;
  y: number;
  texKey: string;
}

export class NpcsView {
  private views = new Map<string, View>();
  private off: () => void;
  private zoom = 0;

  constructor(
    private scene: Phaser.Scene,
    /** the scene's avatar texture (same frames as people: `<dir>-<n>`, `sit-<dir>`) */
    private texFor: (a: Avatar) => string,
  ) {
    let last = store.get().npcs;
    this.sync(last);
    this.off = store.subscribe(() => {
      const npcs = store.get().npcs;
      if (npcs === last) return;
      last = npcs;
      this.sync(npcs);
    });
  }

  /** Where a character is drawn now (for "locate"), or undefined. */
  position(id: string): { x: number; y: number } | undefined {
    const v = this.views.get(id);
    return v ? { x: v.x, y: v.y } : undefined;
  }

  private sync(npcs: NpcState[]) {
    const ids = new Set(npcs.map((n) => n.id));
    for (const n of npcs) this.apply(n);
    for (const id of [...this.views.keys()]) if (!ids.has(id)) this.remove(id);
  }

  private labelText(n: NpcState) {
    return `${n.name} · ${i18n.t('npc.bot')}`;
  }

  private apply(n: NpcState) {
    const key = this.texFor(n.avatar);
    let v = this.views.get(n.id);
    if (!v) {
      const sprite = this.scene.add.sprite(0, 0, key, 'down-0').setOrigin(0.5, 1);
      const body = this.scene.add.container(n.x, n.y, [sprite]);
      const label = this.scene.add
        .text(0, -AV_H - 2, this.labelText(n), {
          fontFamily: 'Atkinson Hyperlegible, sans-serif',
          fontStyle: 'bold',
          color: '#F3F6F8',
          backgroundColor: '#2f6f73',
        })
        .setOrigin(0.5, 1);
      const emote = this.scene.add
        .text(0, -AV_H - 18, '', { fontFamily: 'sans-serif' })
        .setOrigin(0.5, 1)
        .setVisible(false);
      const bubble = this.scene.add
        .text(0, -AV_H - 14, '', {
          fontFamily: 'Atkinson Hyperlegible, sans-serif',
          color: '#17324D',
          backgroundColor: '#F3F6F8',
          align: 'center',
        })
        .setOrigin(0.5, 1)
        .setVisible(false);
      const over = this.scene.add.container(n.x, n.y, [label, bubble, emote]).setDepth(D_OVERLAY);
      v = {
        body,
        sprite,
        over,
        label,
        emote,
        emoteUntil: 0,
        bubble,
        bubbleUntil: 0,
        typing: false,
        goal: n,
        x: n.x,
        y: n.y,
        texKey: key,
      };
      this.views.set(n.id, v);
      this.zoom = 0; // style the new label on the next frame
    }
    if (v.texKey !== key) {
      v.sprite.setTexture(key, v.sprite.frame.name);
      v.texKey = key;
    }
    v.goal = n;
  }

  /**
   * A character waved (`npc:emote`). The server only sends it to people within nearby-chat reach
   * of the character, like a line of nearby chat.
   */
  emote(id: string, emote: NpcEmote) {
    const v = this.views.get(id);
    if (!v) return;
    v.emote.setText(EMOTE_GLYPH[emote]);
    v.emoteUntil = performance.now() + EMOTE_MS;
  }

  /**
   * A character said something (`npc:say`, P15.4); the server only sends it to people a nearby-chat
   * line from the character would reach. Lasts longer for longer lines. Off with the setting.
   */
  say(id: string, body: string) {
    const v = this.views.get(id);
    if (!v || !store.get().settings.npcBubbles) return;
    v.typing = false;
    v.bubble.setText(body.length > 180 ? `${body.slice(0, 178)}…` : body);
    v.bubbleUntil = performance.now() + Math.min(12000, Math.max(4000, body.length * 70));
  }

  /** A character is writing a reply (`npc:typing`). */
  typing(id: string, on: boolean) {
    const v = this.views.get(id);
    if (v) v.typing = on && store.get().settings.npcBubbles;
  }

  /** Called every frame by the scene. */
  update(now: number, dtMs: number) {
    const z = this.scene.cameras.main.zoom;
    if (z !== this.zoom) {
      this.zoom = z;
      const res = z * (window.devicePixelRatio || 1);
      for (const v of this.views.values()) {
        v.label
          .setFontSize(12 / z)
          .setResolution(res)
          .setPadding(4 / z, 1 / z, 4 / z, 1 / z);
        v.emote.setFontSize(20 / z).setResolution(res);
        v.bubble
          .setFontSize(13 / z)
          .setResolution(res)
          .setPadding(6 / z, 4 / z, 6 / z, 4 / z)
          .setWordWrapWidth(200 / z);
      }
    }
    const k = Math.min(1, (dtMs / 1000) * EASE);
    const still = reducedMotion();
    for (const v of this.views.values()) {
      const g = v.goal;
      if (Math.hypot(g.x - v.x, g.y - v.y) > SNAP_PX) {
        v.x = g.x;
        v.y = g.y;
      } else {
        v.x += (g.x - v.x) * k;
        v.y += (g.y - v.y) * k;
      }
      const rx = Math.round(v.x);
      const ry = Math.round(v.y);
      v.body.setPosition(rx, ry).setDepth(v.y);
      v.over.setPosition(rx, ry - (g.p === 'sit' ? 5 : 0));
      if (g.p === 'sit') v.sprite.setFrame(`sit-${g.d}`);
      else v.sprite.setFrame(`${g.d}-${g.m && !still ? WALK_SEQ[Math.floor(now / 130) % 4]! : 0}`);
      const t = performance.now();
      const said = t < v.bubbleUntil;
      const writing = v.typing && !said;
      if (writing) {
        // three dots; they stay still for people who asked for less motion
        const dots = still ? 3 : 1 + (Math.floor(t / 350) % 3);
        const text = '·'.repeat(dots).padEnd(3, ' ');
        if (v.bubble.text !== text) v.bubble.setText(text);
      }
      const bubbleOn = said || writing;
      v.bubble.setVisible(bubbleOn);
      v.bubble.setY(-AV_H - 6 - v.label.height);
      v.emote.setVisible(t < v.emoteUntil);
      v.emote.setY(
        bubbleOn ? -AV_H - 10 - v.label.height - v.bubble.height : -AV_H - 4 - v.label.height,
      );
      const text = this.labelText(g);
      if (v.label.text !== text) v.label.setText(text);
    }
  }

  private remove(id: string) {
    const v = this.views.get(id);
    v?.body.destroy();
    v?.over.destroy();
    this.views.delete(id);
  }

  destroy() {
    this.off();
    for (const id of [...this.views.keys()]) this.remove(id);
  }
}

/**
 * Direct trades between two people (P17.29, ADR-053): who asked whom, what each side puts up, and who
 * confirmed which revision. Lives in the space's memory only: a trade that is not done when someone
 * leaves, drops their connection or moves away is simply over; nothing was moved. The swap itself is
 * one transaction (`executeTrade`), started when both confirmed the same revision.
 */
import { randomBytes } from 'node:crypto';
import {
  EMPTY_OFFER,
  checkOffer,
  type GameData,
  type S2CMsg,
  type TradeEnd,
  type TradeOffer,
  type TradeRefusal,
} from '@agora/shared';
import type { SwapResult } from '../worlds/trade';

interface Trade {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  /** false until the person asked says yes */
  accepted: boolean;
  offers: Record<string, TradeOffer>;
  confirmed: Set<string>;
  rev: number;
  /** the swap is running: nothing changes until it ends */
  swapping: boolean;
}

export interface TradeDeps {
  send(playerId: string, msg: S2CMsg): void;
  nameOf(playerId: string): string | null;
  uidOf(playerId: string): string | null;
  /** both may trade from where they stand now (the same world, or near each other on the floor) */
  together(a: string, b: string): boolean;
  data(): GameData;
  swap(id: string, a: { uid: string; offer: TradeOffer }, b: { uid: string; offer: TradeOffer }): Promise<SwapResult>;
  /** after a swap: each side's bag as the server has it now */
  refresh(playerId: string): void;
  warn(o: object, m: string): void;
}

export class TradeDesk {
  private readonly trades = new Map<string, Trade>();
  private readonly byPlayer = new Map<string, string>();

  constructor(private readonly deps: TradeDeps) {}

  private refuse(pid: string, reason: TradeRefusal, id?: string): void {
    this.deps.send(pid, { t: 'trade:refused', reason, ...(id ? { id } : {}) });
  }

  private mine(pid: string, id: string): Trade | null {
    const t = this.trades.get(id);
    return t && (t.a === pid || t.b === pid) ? t : null;
  }

  /**
   * Each side sees its own offer as "you" and the other's as "them", with both confirmations. Until the
   * person asked says yes, only the asker hears of it (`pending`); the person asked has the question.
   */
  private sendState(t: Trade): void {
    for (const [me, them] of [
      [t.a, t.b],
      [t.b, t.a],
    ] as const) {
      if (!t.accepted && me === t.b) continue;
      this.deps.send(me, {
        t: 'trade:state',
        id: t.id,
        with: this.deps.nameOf(them) ?? '',
        you: t.offers[me] ?? EMPTY_OFFER,
        them: t.offers[them] ?? EMPTY_OFFER,
        rev: t.rev,
        youConfirmed: t.confirmed.has(me),
        themConfirmed: t.confirmed.has(them),
        pending: !t.accepted,
      });
    }
  }

  private close(t: Trade, reason: TradeEnd): void {
    this.trades.delete(t.id);
    if (this.byPlayer.get(t.a) === t.id) this.byPlayer.delete(t.a);
    if (this.byPlayer.get(t.b) === t.id) this.byPlayer.delete(t.b);
    this.deps.send(t.a, { t: 'trade:closed', id: t.id, reason });
    this.deps.send(t.b, { t: 'trade:closed', id: t.id, reason });
  }

  ask(from: string, to: string): void {
    if (from === to) return this.refuse(from, 'self');
    const name = this.deps.nameOf(from);
    if (!name || !this.deps.nameOf(to)) return this.refuse(from, 'gone');
    if (this.deps.uidOf(from) === this.deps.uidOf(to)) return this.refuse(from, 'self');
    if (this.byPlayer.has(from) || this.byPlayer.has(to)) return this.refuse(from, 'busy');
    if (!this.deps.together(from, to)) return this.refuse(from, 'far');
    const id = randomBytes(6).toString('hex');
    const t: Trade = { id, a: from, b: to, accepted: false, offers: {}, confirmed: new Set(), rev: 0, swapping: false };
    this.trades.set(id, t);
    this.byPlayer.set(from, id);
    this.byPlayer.set(to, id);
    this.deps.send(to, { t: 'trade:asked', id, from, name });
    this.sendState(t);
  }

  answer(pid: string, id: string, accept: boolean): void {
    const t = this.mine(pid, id);
    if (!t || t.b !== pid || t.accepted) return this.refuse(pid, 'gone', id);
    if (!accept) return this.close(t, 'declined');
    if (!this.deps.together(t.a, t.b)) return this.refuse(pid, 'far', id);
    t.accepted = true;
    this.sendState(t);
  }

  /** My side, replaced whole. Any change clears both confirmations (each confirms what they see). */
  offer(pid: string, id: string, offer: TradeOffer): void {
    const t = this.mine(pid, id);
    if (!t || !t.accepted) return this.refuse(pid, 'gone', id);
    if (t.swapping) return this.refuse(pid, 'stale', id);
    const rule = checkOffer(this.deps.data(), offer);
    if (!rule.ok) return this.refuse(pid, rule.reason, id);
    t.offers[pid] = { items: { ...offer.items }, money: offer.money };
    t.rev++;
    t.confirmed.clear();
    this.sendState(t);
  }

  /** I accept the state at `rev`. When both have, the swap runs (once). */
  confirm(pid: string, id: string, rev: number): void {
    const t = this.mine(pid, id);
    if (!t || !t.accepted) return this.refuse(pid, 'gone', id);
    if (t.swapping || rev !== t.rev) return this.refuse(pid, 'stale', id);
    if (!this.deps.together(t.a, t.b)) return this.refuse(pid, 'far', id);
    t.confirmed.add(pid);
    if (t.confirmed.size < 2) return this.sendState(t);
    void this.run(t);
  }

  private async run(t: Trade): Promise<void> {
    const ua = this.deps.uidOf(t.a);
    const ub = this.deps.uidOf(t.b);
    if (!ua || !ub) return this.close(t, 'gone');
    t.swapping = true;
    let r: SwapResult;
    try {
      r = await this.deps.swap(
        t.id,
        { uid: ua, offer: t.offers[t.a] ?? EMPTY_OFFER },
        { uid: ub, offer: t.offers[t.b] ?? EMPTY_OFFER },
      );
    } catch (err) {
      this.deps.warn({ err: String(err) }, 'trade swap failed');
      r = { ok: false, reason: 'conflict' };
    }
    t.swapping = false;
    if (r.ok) {
      this.close(t, 'done');
      this.deps.refresh(t.a);
      this.deps.refresh(t.b);
      return;
    }
    // nothing moved: the trade stays open, unconfirmed, and both hear why (unless someone is gone)
    if (!this.trades.has(t.id)) return;
    if (!this.deps.nameOf(t.a) || !this.deps.nameOf(t.b) || !this.deps.together(t.a, t.b)) return this.close(t, 'gone');
    t.confirmed.clear();
    t.rev++;
    this.refuse(t.a, r.reason, t.id);
    this.refuse(t.b, r.reason, t.id);
    this.sendState(t);
  }

  cancel(pid: string, id: string): void {
    const t = this.mine(pid, id);
    if (!t) return this.refuse(pid, 'gone', id);
    if (t.swapping) return this.refuse(pid, 'stale', id);
    this.close(t, 'cancelled');
  }

  /** Someone left, dropped their connection or changed place: their trade is over (unless it is swapping). */
  end(pid: string): void {
    const id = this.byPlayer.get(pid);
    const t = id ? this.trades.get(id) : undefined;
    if (!t || t.swapping) return;
    this.close(t, 'gone');
  }

  /** For tests: the trade a person is in. */
  tradeOf(pid: string): string | null {
    return this.byPlayer.get(pid) ?? null;
  }
}

/**
 * Connection quality from WebRTC stats (P3.9). Pure functions so they can be unit-tested
 * without a browser; MediaManager feeds them `RTCPeerConnection.getStats()` reports.
 */

/** One sample of a peer connection. Null = not measurable yet. */
export interface QualitySample {
  /** round-trip time of the active candidate pair, ms */
  rttMs: number | null;
  /** packets lost since the previous sample, % (incoming and reported outgoing, worst) */
  lossPct: number | null;
  /** estimated outgoing bandwidth, kbit/s */
  outKbps: number | null;
}

export const POOR = { rttMs: 600, lossPct: 8, outKbps: 150 } as const;

export function isPoor(s: QualitySample): boolean {
  return (
    (s.rttMs !== null && s.rttMs > POOR.rttMs) ||
    (s.lossPct !== null && s.lossPct > POOR.lossPct) ||
    (s.outKbps !== null && s.outKbps < POOR.outKbps)
  );
}

/** Running counters kept per peer between two samples. */
export interface LossCounters {
  lost: number;
  received: number;
}

interface StatLike {
  type: string;
  [k: string]: unknown;
}

/**
 * Read a stats report. `prev` holds the inbound counters from the last sample and is
 * updated in place, so loss is measured over the last interval only.
 */
export function sampleFrom(stats: Iterable<StatLike>, prev: LossCounters): QualitySample {
  let rttMs: number | null = null;
  let outKbps: number | null = null;
  let lost = 0;
  let received = 0;
  let remoteFraction: number | null = null;
  for (const r of stats) {
    if (r.type === 'candidate-pair' && (r.nominated || r.selected) && r.state === 'succeeded') {
      if (typeof r.currentRoundTripTime === 'number') rttMs = r.currentRoundTripTime * 1000;
      if (typeof r.availableOutgoingBitrate === 'number')
        outKbps = r.availableOutgoingBitrate / 1000;
    } else if (r.type === 'inbound-rtp') {
      lost += typeof r.packetsLost === 'number' ? Math.max(0, r.packetsLost) : 0;
      received += typeof r.packetsReceived === 'number' ? r.packetsReceived : 0;
    } else if (r.type === 'remote-inbound-rtp' && typeof r.fractionLost === 'number') {
      remoteFraction = Math.max(remoteFraction ?? 0, r.fractionLost);
    }
  }
  const dLost = lost - prev.lost;
  const dRecv = received - prev.received;
  prev.lost = lost;
  prev.received = received;
  const inLoss = dLost + dRecv > 20 && dLost >= 0 ? (100 * dLost) / (dLost + dRecv) : null;
  const outLoss = remoteFraction === null ? null : remoteFraction * 100;
  const lossPct = inLoss === null && outLoss === null ? null : Math.max(inLoss ?? 0, outLoss ?? 0);
  return { rttMs, lossPct, outKbps };
}

/**
 * Debounced verdict: `poor` after `badRun` poor samples in a row, `ok` again after
 * `goodRun` good ones. Returns the new state when it changes, else null.
 */
export class QualityTracker {
  state: 'ok' | 'poor' = 'ok';
  private bad = 0;
  private good = 0;
  constructor(
    private badRun = 2,
    private goodRun = 5,
  ) {}
  push(poor: boolean): 'ok' | 'poor' | null {
    if (poor) {
      this.bad++;
      this.good = 0;
    } else {
      this.good++;
      this.bad = 0;
    }
    if (this.state === 'ok' && this.bad >= this.badRun) return (this.state = 'poor');
    if (this.state === 'poor' && this.good >= this.goodRun) return (this.state = 'ok');
    return null;
  }
}

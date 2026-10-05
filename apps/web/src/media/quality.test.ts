import { describe, expect, it } from 'vitest';
import { QualityTracker, isPoor, sampleFrom, type LossCounters } from './quality';

const pair = (rtt: number, out?: number) => ({
  type: 'candidate-pair',
  nominated: true,
  state: 'succeeded',
  currentRoundTripTime: rtt,
  availableOutgoingBitrate: out,
});
const inbound = (lost: number, received: number) => ({
  type: 'inbound-rtp',
  packetsLost: lost,
  packetsReceived: received,
});

describe('connection quality (P3.9)', () => {
  it('reads RTT, outgoing bandwidth and loss over the last interval', () => {
    const prev: LossCounters = { lost: 0, received: 0 };
    const a = sampleFrom([pair(0.05, 900_000), inbound(0, 500)], prev);
    expect(a).toEqual({ rttMs: 50, outKbps: 900, lossPct: 0 });
    const b = sampleFrom([pair(0.05, 900_000), inbound(30, 770)], prev);
    expect(b.lossPct).toBeCloseTo(10, 5); // 30 lost of 300 in this interval
    expect(prev).toEqual({ lost: 30, received: 770 });
  });

  it('uses the worst of incoming loss and the loss the peer reports', () => {
    const prev: LossCounters = { lost: 0, received: 0 };
    const s = sampleFrom(
      [inbound(0, 100), { type: 'remote-inbound-rtp', fractionLost: 0.2 }],
      prev,
    );
    expect(s.lossPct).toBeCloseTo(20, 5);
  });

  it('ignores pairs that are not in use and tiny intervals', () => {
    const prev: LossCounters = { lost: 0, received: 0 };
    const s = sampleFrom([{ ...pair(2), nominated: false }, inbound(2, 5)], prev);
    expect(s).toEqual({ rttMs: null, outKbps: null, lossPct: null });
  });

  it('judges a sample poor on high RTT, loss or low bandwidth', () => {
    expect(isPoor({ rttMs: 80, lossPct: 1, outKbps: 1200 })).toBe(false);
    expect(isPoor({ rttMs: 900, lossPct: null, outKbps: null })).toBe(true);
    expect(isPoor({ rttMs: null, lossPct: 12, outKbps: null })).toBe(true);
    expect(isPoor({ rttMs: null, lossPct: null, outKbps: 90 })).toBe(true);
    expect(isPoor({ rttMs: null, lossPct: null, outKbps: null })).toBe(false);
  });

  it('switches to poor after two bad samples and back after five good ones', () => {
    const q = new QualityTracker();
    expect(q.push(true)).toBeNull();
    expect(q.push(false)).toBeNull(); // a single blip is ignored
    expect(q.push(true)).toBeNull();
    expect(q.push(true)).toBe('poor');
    expect(q.push(true)).toBeNull();
    for (let i = 0; i < 4; i++) expect(q.push(false)).toBeNull();
    expect(q.push(false)).toBe('ok');
  });
});

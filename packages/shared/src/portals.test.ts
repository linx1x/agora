import { describe, expect, it } from 'vitest';
import { C2S } from './protocol';
import { DEFAULT_DECOR, DESK_ACCESS, podAllows, type DeskState } from './desks';
import {
  PORTAL_REFUSALS,
  PortalSchema,
  WORLD_SPAWN,
  checkPortal,
  deskGate,
  deskOfPortal,
  deskPortalId,
  inPortal,
  portalAllows,
  portalTo,
} from './portals';

/** A pod rectangle in pixels: x 64..160, y 32..96. */
const RECT = { x: 64, y: 32, w: 96, h: 64 };

describe('inPortal', () => {
  it('is half-open: the left and top edges are inside, the right and bottom edges outside', () => {
    expect(inPortal(RECT, 64, 32)).toBe(true);
    expect(inPortal(RECT, 159.9, 95.9)).toBe(true);
    expect(inPortal(RECT, 160, 60)).toBe(false);
    expect(inPortal(RECT, 100, 96)).toBe(false);
    expect(inPortal(RECT, 63.9, 40)).toBe(false);
  });
});

describe('portalAllows', () => {
  it('is exactly the desk pod rule (ADR-017) for every access and visitor', () => {
    for (const access of DESK_ACCESS)
      for (const isOwner of [true, false])
        for (const admitted of [true, false]) {
          const desk: DeskState = {
            id: 'jungle-1',
            ownerName: 'Ann',
            ownerId: null,
            access,
            decor: DEFAULT_DECOR,
          };
          expect(portalAllows(access, isOwner, admitted)).toBe(podAllows(desk, isOwner, admitted));
        }
  });

  it('lets the owner in always, anyone when open, admitted visitors when knock, no one else when closed', () => {
    expect(portalAllows('closed', true, false)).toBe(true);
    expect(portalAllows('open', false, false)).toBe(true);
    expect(portalAllows('knock', false, false)).toBe(false);
    expect(portalAllows('knock', false, true)).toBe(true);
    expect(portalAllows('closed', false, true)).toBe(false);
  });
});

describe('checkPortal', () => {
  const gate = deskGate('jungle-1', RECT, 'knock');
  const inside = { x: 80, y: 40 };
  const outside = { x: 0, y: 0 };

  it('checks the trigger first: outside is refused whoever asks', () => {
    expect(checkPortal(gate, outside, { isOwner: true, admitted: true })).toBe('outside');
    expect(checkPortal(gate, outside, { isOwner: false, admitted: false })).toBe('outside');
  });

  it('then the rights: a visitor not admitted is refused, admitted and the owner pass', () => {
    expect(checkPortal(gate, inside, { isOwner: false, admitted: false })).toBe('no_permission');
    expect(checkPortal(gate, inside, { isOwner: false, admitted: true })).toBe('ok');
    expect(checkPortal(gate, inside, { isOwner: true, admitted: false })).toBe('ok');
  });

  it('a closed pod admits its owner only', () => {
    const closed = deskGate('jungle-1', RECT, 'closed');
    expect(checkPortal(closed, inside, { isOwner: false, admitted: true })).toBe('no_permission');
    expect(checkPortal(closed, inside, { isOwner: true, admitted: false })).toBe('ok');
  });
});

describe('desk portals', () => {
  const portal = portalTo(deskGate('jungle-1', RECT, 'open'), 'world-7f3k');

  it('round-trip between a desk id and its portal id, and name no other portal', () => {
    expect(deskPortalId('jungle-1')).toBe('desk:jungle-1');
    expect(deskOfPortal(deskPortalId('jungle-1'))).toBe('jungle-1');
    expect(deskOfPortal('desk:')).toBeNull();
    expect(deskOfPortal('portal-hub-jungle')).toBeNull();
  });

  it('a desk portal is a valid Portal that arrives at the origin cell of its world', () => {
    expect(PortalSchema.parse(portal)).toEqual(portal);
    expect(portal.target).toEqual({ worldId: 'world-7f3k', spawn: WORLD_SPAWN });
    expect(PORTAL_REFUSALS).toEqual(['disabled', 'unknown', 'outside', 'no_permission', 'no_world']);
  });

  it('the schema rejects a bad id, an empty trigger, an unknown access, an empty world and an extra field', () => {
    expect(PortalSchema.safeParse({ ...portal, id: 'Desk One' }).success).toBe(false);
    expect(PortalSchema.safeParse({ ...portal, trigger: { ...RECT, w: 0 } }).success).toBe(false);
    expect(PortalSchema.safeParse({ ...portal, access: 'public' }).success).toBe(false);
    expect(
      PortalSchema.safeParse({ ...portal, target: { worldId: '', spawn: WORLD_SPAWN } }).success,
    ).toBe(false);
    expect(PortalSchema.safeParse({ ...portal, extra: 1 }).success).toBe(false);
  });
});

describe('portal:enter on the wire', () => {
  it('accepts a portal id and refuses a malformed one', () => {
    expect(C2S.safeParse({ t: 'portal:enter', id: 'desk:jungle-1' }).success).toBe(true);
    expect(C2S.safeParse({ t: 'portal:enter', id: '' }).success).toBe(false);
    expect(C2S.safeParse({ t: 'portal:enter', id: 'desk jungle' }).success).toBe(false);
    expect(C2S.safeParse({ t: 'portal:enter', id: 'x'.repeat(65) }).success).toBe(false);
  });
});

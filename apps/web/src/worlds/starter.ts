/**
 * The starter drawing (P17.10) as the client reads it: the same `packages/maps/worlds/starter.json`
 * the server stamps, checked with the shared parser. The client needs only its return pad (the
 * world's one portal back to the office); the terrain of the stamp arrives in the chunk deltas.
 */
import { parseStarter, returnTrigger, type PortalRect } from '@agora/shared';
import starterJson from '../../../../packages/maps/worlds/starter.json';

export const STARTER = parseStarter(starterJson, 'starter.json');

/** The return pad, in office-free world pixels: stepping on it and pressing X goes back to the desk. */
export const RETURN_RECT: PortalRect = returnTrigger(STARTER);

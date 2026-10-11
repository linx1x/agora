/**
 * Build mode client logic (ADR-021): sends edits, keeps undo/redo of this
 * user's own accepted edits, and toggles the mode. Edits are applied when the
 * server echoes them (`map:edit`), never optimistically.
 */
import { MAX_EDIT_CELLS, type MapChange, type S2CMsg } from '@agora/shared';
import { world } from '../net/client';
import { store, toast } from '../state/store';

const undoStack: MapChange[][] = [];
const redoStack: MapChange[][] = [];
const pending = new Map<number, 'do' | 'undo' | 'redo'>();
let opSeq = 0;
const LIMIT = 100;

const sync = () => store.set({ undoCount: undoStack.length, redoCount: redoStack.length });

function send(cells: MapChange[], kind: 'do' | 'undo' | 'redo') {
  for (let i = 0; i < cells.length; i += MAX_EDIT_CELLS) {
    const op = ++opSeq;
    pending.set(op, kind);
    world.send({ t: 'map:edit', op, cells: cells.slice(i, i + MAX_EDIT_CELLS) });
  }
}

export function sendEdit(cells: MapChange[]) {
  if (cells.length) send(cells, 'do');
}

/** Undos asked for while one of my edits was still on its way (they wait for its echo). */
let queuedUndo = 0;
const waitingForDo = () => [...pending.values()].includes('do');

export function undo() {
  // a keyboard nudge not sent yet is simply dropped (P9.17)
  if (selCmd({ t: 'cancel' })) return;
  if (waitingForDo()) {
    queuedUndo++;
    return;
  }
  const inv = undoStack.pop();
  if (inv) send(inv, 'undo');
  sync();
}

export function redo() {
  const again = redoStack.pop();
  if (again) send(again, 'redo');
  sync();
}

/** Server accepted one of my ops; `inverse` was computed just before applying it. */
export function ack(op: number, inverse: MapChange[]) {
  const kind = pending.get(op);
  if (!kind) return;
  pending.delete(op);
  if (kind === 'undo') redoStack.push(inverse);
  else {
    undoStack.push(inverse);
    if (undoStack.length > LIMIT) undoStack.shift();
    if (kind === 'do') redoStack.length = 0;
  }
  sync();
  runQueuedUndo();
}

function runQueuedUndo() {
  if (!queuedUndo || waitingForDo()) return;
  queuedUndo--;
  undo();
}

export function refused(m: Extract<S2CMsg, { t: 'map:refused' }>) {
  pending.delete(m.op);
  toast(`build.refused.${m.reason}`, undefined, 4500);
  runQueuedUndo();
}

/** Forget history (map replaced). */
export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  pending.clear();
  queuedUndo = 0;
  sync();
}

let panelWasOpen = false;
export function setBuild(on: boolean) {
  const s = store.get();
  if (on && (!s.builder || s.config?.flags.builder === false)) return;
  if (!on && s.build)
    store.set({ build: null, buildPrefs: s.build, buildSel: null, panelOpen: panelWasOpen });
  else if (on && !s.build) {
    panelWasOpen = s.panelOpen;
    store.set({ build: { ...s.buildPrefs }, panelOpen: false });
    toast('build.entered', undefined, 3000);
  }
}

export function patchBuild(patch: Partial<NonNullable<ReturnType<typeof store.get>['build']>>) {
  const b = store.get().build;
  if (b) store.set({ build: { ...b, ...patch } });
}

/** Theme actually used for new tiles. */
export function effectiveTheme(): import('@agora/shared').Biome {
  const s = store.get();
  const t = s.build?.theme ?? 'auto';
  return t === 'auto' ? s.cursorBiome : t;
}

/** What the build panel asks of the Select tool's selection (P9.17–P9.20). */
export type SelCmd =
  | { t: 'nudge'; dx: number; dy: number }
  | { t: 'raise'; dz: number }
  | { t: 'flip' }
  | { t: 'rotate' }
  | { t: 'delete' }
  | { t: 'grow'; dir: 'n' | 'e' | 's' | 'w' }
  | { t: 'shrink'; dir: 'n' | 'e' | 's' | 'w' }
  | { t: 'clear' }
  /** drop a keyboard nudge that is not sent yet; true if there was one */
  | { t: 'cancel' };

let selHandler: ((c: SelCmd) => boolean | void) | null = null;
/** The 2.5D build mode (BuildMode3D) handles selection commands; returns an unsubscribe. */
export function onSelCmd(h: (c: SelCmd) => boolean | void): () => void {
  selHandler = h;
  return () => {
    if (selHandler === h) selHandler = null;
  };
}
export function selCmd(c: SelCmd): boolean {
  return !!selHandler?.(c);
}

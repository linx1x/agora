/**
 * Build mode client logic (ADR-021): sends edits, keeps undo/redo of this
 * user's own accepted edits, and toggles the mode. Edits are applied when the
 * server echoes them (`map:edit`), never optimistically.
 */
import { MAX_EDIT_CELLS, type CellChange, type S2CMsg } from '@agora/shared';
import { world } from '../net/client';
import { store, toast } from '../state/store';

const undoStack: CellChange[][] = [];
const redoStack: CellChange[][] = [];
const pending = new Map<number, 'do' | 'undo' | 'redo'>();
let opSeq = 0;
const LIMIT = 100;

const sync = () => store.set({ undoCount: undoStack.length, redoCount: redoStack.length });

function send(cells: CellChange[], kind: 'do' | 'undo' | 'redo') {
  for (let i = 0; i < cells.length; i += MAX_EDIT_CELLS) {
    const op = ++opSeq;
    pending.set(op, kind);
    world.send({ t: 'map:edit', op, cells: cells.slice(i, i + MAX_EDIT_CELLS) });
  }
}

export function sendEdit(cells: CellChange[]) {
  if (cells.length) send(cells, 'do');
}

export function undo() {
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
export function ack(op: number, inverse: CellChange[]) {
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
}

export function refused(m: Extract<S2CMsg, { t: 'map:refused' }>) {
  pending.delete(m.op);
  toast(`build.refused.${m.reason}`, undefined, 4500);
}

/** Forget history (map replaced). */
export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  pending.clear();
  sync();
}

let panelWasOpen = false;
export function setBuild(on: boolean) {
  const s = store.get();
  if (on && (!s.builder || s.config?.flags.builder === false)) return;
  if (!on && s.build) store.set({ build: null, buildPrefs: s.build, panelOpen: panelWasOpen });
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

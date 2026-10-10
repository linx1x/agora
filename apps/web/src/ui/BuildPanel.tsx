import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Brush,
  ChevronsDown,
  ChevronsUp,
  Eraser,
  FlipHorizontal2,
  Grid3x3,
  Magnet,
  MousePointer2,
  Pipette,
  Redo2,
  RotateCcw,
  RotateCw,
  ShieldAlert,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { BIOMES, MAX_LIFT, PALETTE, TILE_DEFS, themedTile, type Biome } from '@agora/shared';
import {
  effectiveTheme,
  patchBuild,
  redo,
  selCmd,
  setBuild,
  undo,
  type SelCmd,
} from '../game/build';
import { isTyping } from '../game/input';
import { tileThumb } from '../game/tiles';
import { world } from '../net/client';
import { store, useStore, type BuildGroup, type BuildSel } from '../state/store';
import { Dialog } from './common';

const GROUPS: BuildGroup[] = ['objects', 'props', 'floor', 'walls', 'overhead'];

/** i18n key of a tile's name (`build.tile.<base>`; props use their full name). */
const tileKey = (name: string) => {
  const d = TILE_DEFS.find((q) => q.name === name);
  const base = d?.base === 'wallFront' ? 'wallTop' : (d?.base ?? name);
  return `build.tile.${base}`;
};

/** Build mode palette and tools (ADR-021). Left side; the canvas takes the pointer strokes. */
export function BuildPanel() {
  const { t } = useTranslation();
  const build = useStore((s) => s.build);
  const undoCount = useStore((s) => s.undoCount);
  const redoCount = useStore((s) => s.redoCount);
  const sel = useStore((s) => s.buildSel);
  const placement = useStore((s) => s.config?.flags.placement !== false);
  useStore((s) => s.cursorBiome);

  useEffect(() => {
    if (!build) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping() || store.get().dialog) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        redo();
      } else if (mod || e.altKey) return;
      else if (k === 'escape') {
        // Esc first lets go of the selection, then leaves build mode
        if (store.get().buildSel) selCmd({ t: 'clear' });
        else setBuild(false);
      } else if (k === 'q') patchBuild({ tool: 'paint' });
      else if (k === 'c' && store.get().config?.flags.placement !== false)
        patchBuild({ tool: 'select' });
      else if (k === 'e') patchBuild({ tool: 'erase' });
      else if (k === 'i') patchBuild({ tool: 'pick' });
      else if (k === 'g') patchBuild({ grid: !store.get().build?.grid });
      else if (k === 'o') patchBuild({ collision: !store.get().build?.collision });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [build]);

  if (!build) return null;
  const group = PALETTE.find((p) => p.group === build.group)!;
  // the Select tool shows the selection instead of the palette (P9.17)
  const selecting = placement && build.tool === 'select';
  const tools = [
    { id: 'paint', icon: Brush, key: 'Q' },
    { id: 'erase', icon: Eraser, key: 'E' },
    { id: 'pick', icon: Pipette, key: 'I' },
    ...(placement ? ([{ id: 'select', icon: MousePointer2, key: 'C' }] as const) : []),
  ] as const;

  return (
    <aside className="build-panel" aria-label={t('build.title')}>
      <header className="build-head">
        <h2>{t('build.title')}</h2>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setBuild(false)}
          aria-label={t('build.exit')}
          title={`${t('build.exit')} (Esc / B)`}
        >
          <X size={18} aria-hidden />
        </button>
      </header>

      <div className="build-tools" role="toolbar" aria-label={t('build.tools')}>
        {tools.map(({ id, icon: Icon, key }) => (
          <button
            key={id}
            type="button"
            className="ctrl"
            aria-pressed={build.tool === id}
            onClick={() => patchBuild({ tool: id })}
            title={`${t(`build.tool.${id}`)} (${key})`}
          >
            <Icon size={18} aria-hidden />
            <span className="sr-only">{t(`build.tool.${id}`)}</span>
          </button>
        ))}
        <span className="build-sep" aria-hidden />
        <button
          type="button"
          className="ctrl"
          onClick={undo}
          disabled={!undoCount}
          title={`${t('build.undo')} (Ctrl+Z)`}
        >
          <Undo2 size={18} aria-hidden />
          <span className="sr-only">{t('build.undo')}</span>
        </button>
        <button
          type="button"
          className="ctrl"
          onClick={redo}
          disabled={!redoCount}
          title={`${t('build.redo')} (Ctrl+Shift+Z)`}
        >
          <Redo2 size={18} aria-hidden />
          <span className="sr-only">{t('build.redo')}</span>
        </button>
        <span className="build-sep" aria-hidden />
        <button
          type="button"
          className="ctrl"
          aria-pressed={build.grid}
          onClick={() => patchBuild({ grid: !build.grid })}
          title={`${t('build.grid')} (G)`}
        >
          <Grid3x3 size={18} aria-hidden />
          <span className="sr-only">{t('build.grid')}</span>
        </button>
        <button
          type="button"
          className="ctrl"
          aria-pressed={build.collision}
          onClick={() => patchBuild({ collision: !build.collision })}
          title={`${t('build.collision')} (O)`}
        >
          <ShieldAlert size={18} aria-hidden />
          <span className="sr-only">{t('build.collision')}</span>
        </button>
        {placement && (
          <button
            type="button"
            className="ctrl"
            aria-pressed={build.snap}
            onClick={() => patchBuild({ snap: !build.snap })}
            title={t('build.snapHint')}
          >
            <Magnet size={18} aria-hidden />
            <span className="sr-only">{t('build.snap')}</span>
          </button>
        )}
      </div>

      {selecting && <SelectionPanel sel={sel} />}

      {!selecting && (
        <>
          <label className="field compact build-theme">
            <span className="small">{t('build.theme')}</span>
            <select
              value={build.theme}
              onChange={(e) => patchBuild({ theme: e.target.value as Biome | 'auto' })}
            >
              <option value="auto">
                {t('build.themeAuto', { theme: t(`build.biome.${effectiveTheme()}`) })}
              </option>
              {BIOMES.map((b) => (
                <option key={b} value={b}>
                  {t(`build.biome.${b}`)}
                </option>
              ))}
            </select>
          </label>

          {placement && build.tool === 'paint' && build.group === 'props' && (
            <div className="build-tools" role="toolbar" aria-label={t('build.brush')}>
              <button
                type="button"
                className="ctrl"
                aria-pressed={build.flip}
                onClick={() => patchBuild({ flip: !build.flip })}
                title={`${t('build.flip')} (F)`}
              >
                <FlipHorizontal2 size={18} aria-hidden />
                <span className="sr-only">{t('build.flip')}</span>
              </button>
              <span className="muted small">{t('build.propHint')}</span>
            </div>
          )}

          <div className="tabs" role="tablist" aria-label={t('build.groups')}>
            {GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                className="tab"
                aria-selected={build.group === g}
                onClick={() => patchBuild({ group: g, tool: 'paint' })}
              >
                {t(`build.group.${g}`)}
              </button>
            ))}
          </div>

          <div
            className="build-palette"
            role="listbox"
            aria-label={t(`build.group.${build.group}`)}
          >
            {group.bases.map((b) => {
              const name = themedTile(b, effectiveTheme());
              const selected = build.base[build.group] === b;
              return (
                <button
                  key={b}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="build-tile"
                  onClick={(e) => {
                    patchBuild({ tool: 'paint', base: { ...build.base, [build.group]: b } });
                    // chosen with the keyboard: hand focus back to the map so arrows + Enter place it
                    if (e.detail === 0) e.currentTarget.blur();
                  }}
                  title={t(`build.tile.${b}`)}
                >
                  <img src={tileThumb(name)} alt="" className="pixel" />
                  <span>{t(`build.tile.${b}`)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <p className="build-help muted small">
        {selecting ? t('build.helpPlacement') : t('build.help')}
      </p>
      <button
        type="button"
        className="btn ghost build-reset"
        onClick={() => store.set({ dialog: 'buildReset' })}
      >
        <RotateCcw size={16} aria-hidden /> {t('build.reset')}
      </button>
    </aside>
  );
}

/** Select tool controls (P9.17–P9.20): what is selected and what can be done to it. */
function SelectionPanel({ sel }: { sel: BuildSel | null }) {
  const { t } = useTranslation();
  if (!sel)
    return (
      <section className="build-sel" aria-label={t('build.sel.title')}>
        <p className="muted small">{t('build.sel.none')}</p>
      </section>
    );
  const btn = (cmd: SelCmd, label: string, Icon: typeof X, key?: string, disabled = false) => (
    <button
      type="button"
      className="ctrl"
      onClick={() => selCmd(cmd)}
      disabled={disabled}
      title={key ? `${label} (${key})` : label}
      aria-label={label}
    >
      <Icon size={16} aria-hidden />
    </button>
  );
  const name = t(tileKey(sel.t));
  const sh = t('build.key.shift');
  const del = t('build.key.del');
  return (
    <section className="build-sel" aria-label={t('build.sel.title')}>
      <div className="build-sel-head">
        <strong>{name}</strong>
        <button
          type="button"
          className="icon-btn"
          onClick={() => selCmd({ t: 'clear' })}
          aria-label={t('build.sel.clear')}
          title={`${t('build.sel.clear')} (Esc)`}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      {sel.kind === 'prop' && (
        <>
          <p className="muted small" aria-live="polite">
            {t('build.sel.where', { x: sel.x, y: sel.y, z: sel.z })}
          </p>
          <div className="build-tools" role="toolbar" aria-label={t('build.sel.title')}>
            {btn({ t: 'nudge', dx: -1, dy: 0 }, t('build.nudge.w'), ArrowLeft, '←')}
            {btn({ t: 'nudge', dx: 0, dy: -1 }, t('build.nudge.n'), ArrowUp, '↑')}
            {btn({ t: 'nudge', dx: 0, dy: 1 }, t('build.nudge.s'), ArrowDown, '↓')}
            {btn({ t: 'nudge', dx: 1, dy: 0 }, t('build.nudge.e'), ArrowRight, '→')}
            <span className="build-sep" aria-hidden />
            {btn({ t: 'raise', dz: 1 }, t('build.raise'), ChevronsUp, 'PgUp', sel.z >= MAX_LIFT)}
            {btn({ t: 'raise', dz: -1 }, t('build.lower'), ChevronsDown, 'PgDn', sel.z <= 0)}
            <span className="build-sep" aria-hidden />
            {btn({ t: 'flip' }, t('build.flip'), FlipHorizontal2, 'F')}
            {btn({ t: 'rotate' }, t('build.rotate'), RotateCw, 'R', !sel.turn)}
            {btn({ t: 'delete' }, t('build.sel.delete'), Trash2, del)}
          </div>
        </>
      )}
      {sel.kind === 'run' && (
        <>
          <p className="muted small" aria-live="polite">
            {t('build.sel.length', { count: sel.len })}
          </p>
          <div className="build-stretch">
            <span className="small">{t('build.sel.lengthen')}</span>
            {sel.axes.includes('h') && (
              <>
                {btn({ t: 'grow', dir: 'w' }, t('build.grow.w'), ArrowLeft, `${sh}+←`)}
                {btn({ t: 'grow', dir: 'e' }, t('build.grow.e'), ArrowRight, `${sh}+→`)}
              </>
            )}
            {sel.axes.includes('v') && (
              <>
                {btn({ t: 'grow', dir: 'n' }, t('build.grow.n'), ArrowUp, `${sh}+↑`)}
                {btn({ t: 'grow', dir: 's' }, t('build.grow.s'), ArrowDown, `${sh}+↓`)}
              </>
            )}
            <span className="small">{t('build.sel.shorten')}</span>
            {sel.axes.includes('h') && (
              <>
                {btn(
                  { t: 'shrink', dir: 'w' },
                  t('build.shrink.w'),
                  ArrowLeft,
                  `Ctrl+${sh}+←`,
                  sel.len < 2,
                )}
                {btn(
                  { t: 'shrink', dir: 'e' },
                  t('build.shrink.e'),
                  ArrowRight,
                  `Ctrl+${sh}+→`,
                  sel.len < 2,
                )}
              </>
            )}
            {sel.axes.includes('v') && (
              <>
                {btn(
                  { t: 'shrink', dir: 'n' },
                  t('build.shrink.n'),
                  ArrowUp,
                  `Ctrl+${sh}+↑`,
                  sel.len < 2,
                )}
                {btn(
                  { t: 'shrink', dir: 's' },
                  t('build.shrink.s'),
                  ArrowDown,
                  `Ctrl+${sh}+↓`,
                  sel.len < 2,
                )}
              </>
            )}
          </div>
          <p className="muted small">{t('build.sel.handles')}</p>
        </>
      )}
      {sel.kind === 'cell' && (
        <div className="build-tools" role="toolbar" aria-label={t('build.sel.title')}>
          {btn({ t: 'rotate' }, t('build.rotate'), RotateCw, 'R', !sel.turn)}
          {btn({ t: 'delete' }, t('build.sel.delete'), Trash2, del)}
        </div>
      )}
    </section>
  );
}

export function BuildResetDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog title={t('build.resetTitle')} onClose={onClose}>
      <p>{t('build.resetBody')}</p>
      <div className="dialog-actions">
        <button type="button" className="btn secondary" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn primary danger"
          onClick={() => {
            world.send({ t: 'map:reset' });
            onClose();
          }}
        >
          {t('build.resetConfirm')}
        </button>
      </div>
    </Dialog>
  );
}

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Brush,
  Eraser,
  Grid3x3,
  Pipette,
  Redo2,
  RotateCcw,
  ShieldAlert,
  Undo2,
  X,
} from 'lucide-react';
import { BIOMES, PALETTE, themedTile, type Biome } from '@agora/shared';
import { effectiveTheme, patchBuild, redo, setBuild, undo } from '../game/build';
import { isTyping } from '../game/input';
import { tileThumb } from '../game/tiles';
import { world } from '../net/client';
import { store, useStore, type BuildGroup } from '../state/store';
import { Dialog } from './common';

const GROUPS: BuildGroup[] = ['objects', 'props', 'floor', 'walls', 'overhead'];

/** Build mode palette and tools (ADR-021). Left side; the canvas takes the pointer strokes. */
export function BuildPanel() {
  const { t } = useTranslation();
  const build = useStore((s) => s.build);
  const undoCount = useStore((s) => s.undoCount);
  const redoCount = useStore((s) => s.redoCount);
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
      else if (k === 'escape') setBuild(false);
      else if (k === 'q') patchBuild({ tool: 'paint' });
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
  const tools = [
    { id: 'paint', icon: Brush, key: 'Q' },
    { id: 'erase', icon: Eraser, key: 'E' },
    { id: 'pick', icon: Pipette, key: 'I' },
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
      </div>

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

      <div className="build-palette" role="listbox" aria-label={t(`build.group.${build.group}`)}>
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

      <p className="build-help muted small">{t('build.help')}</p>
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

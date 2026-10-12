import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TUNING_FIELDS,
  WORLDGEN,
  previewCells,
  tuningJson,
  tuningValue,
  waterShare,
  withTuning,
  worldSeedFor,
  type TuningGroup,
  type WorldGenParams,
} from '@agora/shared';
import { Dialog } from '../ui/common';
import { colourOfBlock, paintPreview } from './minimap';
import './tuning.css';

/** Cells across the preview, and canvas pixels per cell. */
const SIZE = 96;
const PX = 3;
const GROUPS: readonly TuningGroup[] = ['elevation', 'temperature', 'humidity', 'shape', 'rivers'];
/** The top block of each biome, which is the colour its chip shows. */
const BIOME_TOP = [
  ['meadow', 'meadow_grass'],
  ['jungle', 'jungle_grass'],
  ['desert', 'desert_sand'],
  ['taiga', 'taiga_moss'],
] as const;

/**
 * The world tuning panel (P17.12, ADR-053): every value of `worldgen.json` as a slider, a preview
 * from the shared generator, a seed box and a copy of the params JSON. Dev and builders only (the
 * caller decides). It changes nothing on the server.
 */
export function WorldTuning({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [params, setParams] = useState<WorldGenParams>(WORLDGEN.params);
  const [seedText, setSeedText] = useState('agora');
  const [status, setStatus] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  // the sliders stay responsive while the preview catches up
  const shown = useDeferredValue(params);
  const cells = useMemo(
    () => previewCells(shown, worldSeedFor(seedText), SIZE),
    [shown, seedText],
  );
  const json = useMemo(() => tuningJson(params), [params]);
  const water = Math.round(waterShare(cells) * 100);

  useEffect(() => {
    if (canvas.current) paintPreview(canvas.current, cells, SIZE, PX);
  }, [cells]);

  // how many cells of each block the preview holds, most first
  const shares = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cells) {
      const id = c.liquid ? 'water' : c.block;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [cells]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setStatus(t('worlds.tuning.copied'));
    } catch {
      setStatus(t('worlds.tuning.copyFailed'));
    }
  };

  return (
    <Dialog title={t('worlds.tuning.title')} onClose={onClose} wide className="world-tuning">
      <p className="wt-intro">{t('worlds.tuning.intro')}</p>
      <div className="wt-bar">
        <label className="wt-seed">
          {t('worlds.tuning.seed')}
          <input
            type="text"
            value={seedText}
            maxLength={64}
            onChange={(e) => setSeedText(e.target.value)}
          />
        </label>
        <button type="button" onClick={() => setParams(WORLDGEN.params)}>
          {t('worlds.tuning.reset')}
        </button>
        <button type="button" onClick={() => void copy()}>
          {t('worlds.tuning.copy')}
        </button>
        <span role="status" aria-live="polite" className="wt-status">
          {status}
        </span>
      </div>
      <div className="wt-body">
        <div className="wt-sliders">
          {GROUPS.map((g) => (
            <fieldset key={g} className="wt-group">
              <legend>{t(`worlds.group.${g}`)}</legend>
              {TUNING_FIELDS.filter((f) => f.group === g).map((f) => {
                const id = `wt-${f.key.replace(/\./g, '-')}`;
                const v = tuningValue(params, f.key);
                return (
                  <div className="wt-row" key={f.key}>
                    <label htmlFor={id}>{t(`worlds.param.${f.key}`)}</label>
                    <input
                      id={id}
                      type="range"
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={v}
                      onChange={(e) =>
                        setParams((p) => withTuning(p, f.key, Number(e.target.value)))
                      }
                    />
                    <output htmlFor={id}>{v}</output>
                  </div>
                );
              })}
            </fieldset>
          ))}
        </div>
        <div className="wt-view">
          <canvas
            ref={canvas}
            role="img"
            className="wt-canvas"
            aria-label={t('worlds.tuning.summary', { size: SIZE, water })}
          />
          <h3>{t('worlds.tuning.legend')}</h3>
          <ul className="wt-legend">
            {BIOME_TOP.map(([biome, top]) => (
              <li key={biome}>
                <span className="wt-chip" style={{ background: colourOfBlock(top) }} aria-hidden />
                {t(`worlds.biome.${biome}`)}
              </li>
            ))}
            {shares.map(([id, n]) => (
              <li key={id}>
                <span className="wt-chip" style={{ background: colourOfBlock(id) }} aria-hidden />
                {t(`worlds.block.${id}`)} <span className="wt-share">{Math.round((100 * n) / cells.length)} %</span>
              </li>
            ))}
          </ul>
          <label className="wt-json">
            {t('worlds.tuning.json')}
            <textarea readOnly rows={8} value={json} />
          </label>
        </div>
      </div>
    </Dialog>
  );
}

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DESK_ACCESS,
  LAMP_COLORS,
  MAX_PLATE_LEN,
  PLANT_STYLES,
  POSTERS,
  DEFAULT_DECOR,
  type DeskAccess,
  type DeskDecor,
} from '@agora/shared';
import { decorPreview } from '../game/avatars';
import { world } from '../net/client';
import { store, useStore } from '../state/store';
import { Dialog } from './common';

/** Personalise your desk pod: access, plant, lamp colour, poster, nameplate (ADR-017). */
export function DeskDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const myDesk = useStore((s) => s.myDesk);
  const desk = useStore((s) => s.desks.find((d) => d.id === s.myDesk));
  const [access, setAccess] = useState<DeskAccess>(desk?.access ?? 'open');
  const [decor, setDecor] = useState<DeskDecor>(desk?.decor ?? DEFAULT_DECOR);
  const previews = useMemo(
    () => ({
      plant: PLANT_STYLES.map((_, i) => decorPreview(0, i, 2)),
      poster: POSTERS.map((_, i) => decorPreview(2, i, 2)),
    }),
    [],
  );
  if (!myDesk || !desk) {
    return (
      <Dialog title={t('desk.title')} onClose={onClose}>
        <p>{t('desk.none')}</p>
      </Dialog>
    );
  }
  const save = () => {
    world.send({ t: 'desk:update', access, decor: { ...decor, message: decor.message.trim() } });
    onClose();
  };
  return (
    <Dialog title={t('desk.title')} onClose={onClose} wide>
      <div className="stack">
        <fieldset className="fieldset">
          <legend>{t('desk.access')}</legend>
          <div className="radio-row">
            {DESK_ACCESS.map((a) => (
              <label key={a} className={`radio-card${access === a ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="access"
                  value={a}
                  checked={access === a}
                  onChange={() => setAccess(a)}
                />
                <strong>{t(`desk.access_${a}`)}</strong>
                <span className="muted small">{t(`desk.access_${a}_hint`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="fieldset">
          <legend>{t('desk.plant')}</legend>
          <div className="choice-row">
            {PLANT_STYLES.map((p, i) => (
              <button
                key={p}
                type="button"
                className={`choice${decor.plant === i ? ' selected' : ''}`}
                aria-pressed={decor.plant === i}
                onClick={() => setDecor({ ...decor, plant: i })}
              >
                <img src={previews.plant[i]} alt="" className="pixel" width={48} height={60} />
                <span className="small">{t(`desk.plants.${p}`)}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="fieldset">
          <legend>{t('desk.lamp')}</legend>
          <div className="choice-row">
            {LAMP_COLORS.map((c, i) => (
              <button
                key={c}
                type="button"
                className={`swatch-btn${decor.lamp === i ? ' selected' : ''}`}
                style={{ background: c }}
                aria-pressed={decor.lamp === i}
                aria-label={t(`desk.lamps.${i}`)}
                title={t(`desk.lamps.${i}`)}
                onClick={() => setDecor({ ...decor, lamp: i })}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="fieldset">
          <legend>{t('desk.poster')}</legend>
          <div className="choice-row">
            {POSTERS.map((p, i) => (
              <button
                key={p}
                type="button"
                className={`choice${decor.poster === i ? ' selected' : ''}`}
                aria-pressed={decor.poster === i}
                onClick={() => setDecor({ ...decor, poster: i })}
              >
                <img src={previews.poster[i]} alt="" className="pixel" width={48} height={60} />
                <span className="small">{t(`desk.posters.${p}`)}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span>{t('desk.message')}</span>
          <input
            value={decor.message}
            maxLength={MAX_PLATE_LEN}
            placeholder={t('desk.messagePlaceholder')}
            onChange={(e) => setDecor({ ...decor, message: e.target.value })}
          />
        </label>
        <div className="row-between">
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              world.send({ t: 'desk:release' });
              onClose();
            }}
          >
            {t('desk.release')}
          </button>
          <div className="row-gap">
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                store.set({ navRequest: { kind: 'desk' } });
                onClose();
              }}
            >
              {t('desk.goto')}
            </button>
            <button type="button" className="btn primary" onClick={save}>
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

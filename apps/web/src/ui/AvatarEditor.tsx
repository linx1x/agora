import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, RotateCw, Shuffle } from 'lucide-react';
import {
  ACCESSORIES,
  BOTTOM_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  MAX_NAME_LEN,
  SKIN_TONES,
  TOP_COLORS,
  randomAvatar,
  type Avatar,
} from '@agora/shared';
import { avatarPreviewDataUrl } from '../game/textures';
import { paperPreviewDataUrl } from '../game3d/paperAvatar';
import type { PaperDir } from '../game3d/paperLayout';
import { useStore } from '../state/store';
import { Dialog } from './common';

/** Order in which the Turn button cycles the paper preview: face, right, back, left. */
const NEXT_DIR: Record<PaperDir, PaperDir> = {
  down: 'right',
  right: 'up',
  up: 'left',
  left: 'down',
};

const FIELDS: {
  key: keyof Avatar;
  count: number;
  label: string;
  names?: readonly string[];
  colors?: string[];
}[] = [
  { key: 'skin', count: SKIN_TONES.length, label: 'avatar.skin', colors: SKIN_TONES },
  { key: 'hair', count: HAIR_STYLES.length, label: 'avatar.hair', names: HAIR_STYLES },
  { key: 'hairColor', count: HAIR_COLORS.length, label: 'avatar.hairColor', colors: HAIR_COLORS },
  { key: 'top', count: TOP_COLORS.length, label: 'avatar.top', colors: TOP_COLORS },
  { key: 'bottom', count: BOTTOM_COLORS.length, label: 'avatar.bottom', colors: BOTTOM_COLORS },
  { key: 'accessory', count: ACCESSORIES.length, label: 'avatar.accessory', names: ACCESSORIES },
];

export function AvatarEditor({
  initial,
  name: initialName,
  onSave,
  onClose,
  firstTime,
}: {
  initial: Avatar;
  name: string;
  onSave: (a: Avatar, name: string) => void;
  onClose: () => void;
  firstTime?: boolean;
}) {
  const { t } = useTranslation();
  const world25d = useStore((s) => s.config?.flags.world25d === true);
  const [a, setA] = useState<Avatar>(initial);
  const [name, setName] = useState(initialName);
  const [dir, setDir] = useState<PaperDir>('down');
  // Flag off: the same 128×160 pixel preview as before. Flag on: the 2.5D paper art plus a 64×80 2D view.
  const preview = useMemo(() => avatarPreviewDataUrl(a, world25d ? 2 : 4), [a, world25d]);
  const paperPreview = useMemo(
    () => (world25d ? paperPreviewDataUrl(a, dir) : ''),
    [a, dir, world25d],
  );
  const step = (k: keyof Avatar, n: number, d: number) =>
    setA((v) => ({ ...v, [k]: (v[k] + d + n) % n }));

  return (
    <Dialog title={t(firstTime ? 'avatar.titleFirst' : 'avatar.title')} onClose={onClose}>
      <div className="avatar-editor">
        <div className="avatar-preview">
          {world25d ? (
            <>
              <div className="avatar-previews">
                <figure className="avatar-fig">
                  <img
                    className="avatar-paper-img"
                    data-testid="avatar-paper-preview"
                    src={paperPreview}
                    alt={t('avatar.paperPreviewAlt')}
                    width={140}
                    height={204}
                  />
                  <figcaption>{t('avatar.paperCaption')}</figcaption>
                </figure>
                <figure className="avatar-fig">
                  <img
                    data-testid="avatar-pixel-preview"
                    src={preview}
                    alt={t('avatar.pixelPreviewAlt')}
                    width={64}
                    height={80}
                  />
                  <figcaption>{t('avatar.pixelCaption')}</figcaption>
                </figure>
              </div>
              <div className="avatar-turn-row">
                <button
                  type="button"
                  className="btn secondary"
                  data-testid="avatar-turn"
                  onClick={() => setDir((d) => NEXT_DIR[d])}
                >
                  <RotateCw size={16} aria-hidden /> {t('avatar.turn')}
                </button>
                <span className="avatar-dir" aria-hidden>
                  {t(`avatar.dir.${dir}`)}
                </span>
                <span className="sr-only" aria-live="polite">
                  {t(`avatar.dir.${dir}`)}
                </span>
              </div>
            </>
          ) : (
            <img src={preview} alt={t('avatar.previewAlt')} width={128} height={160} />
          )}
          <button type="button" className="btn secondary" onClick={() => setA(randomAvatar())}>
            <Shuffle size={16} aria-hidden /> {t('avatar.randomize')}
          </button>
        </div>
        <div className="avatar-fields">
          <label className="field">
            <span>{t('avatar.displayName')}</span>
            <input
              value={name}
              maxLength={MAX_NAME_LEN}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {FIELDS.map((f) => {
            const val = a[f.key];
            const valueLabel = f.names
              ? t(`avatar.opt.${f.names[val]}`)
              : t('avatar.choice', { n: val + 1, total: f.count });
            return (
              <div className="picker" key={f.key} role="group" aria-label={t(f.label)}>
                <span className="picker-label">{t(f.label)}</span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => step(f.key, f.count, -1)}
                  aria-label={t('avatar.prev', { what: t(f.label) })}
                >
                  <ChevronLeft size={18} aria-hidden />
                </button>
                <span className="picker-value" aria-live="polite">
                  {f.colors && (
                    <span className="swatch" style={{ background: f.colors[val] }} aria-hidden />
                  )}
                  {valueLabel}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => step(f.key, f.count, 1)}
                  aria-label={t('avatar.next', { what: t(f.label) })}
                >
                  <ChevronRight size={18} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="btn primary"
          disabled={!name.trim()}
          onClick={() => onSave(a, name.trim())}
        >
          {t(firstTime ? 'avatar.enter' : 'common.save')}
        </button>
      </div>
    </Dialog>
  );
}

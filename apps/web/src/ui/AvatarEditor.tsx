import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, RotateCw, Shuffle } from 'lucide-react';
import {
  ACCESSORIES,
  ACTION_KINDS,
  EMOTES,
  BOTTOM_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  MAX_NAME_LEN,
  SKIN_TONES,
  TOP_COLORS,
  GENDERS,
  TOP_STYLES,
  BOTTOM_STYLES,
  SHOES,
  SHOE_COLORS,
  BELTS,
  BUCKLES,
  VESTS,
  VEST_COLORS,
  COSTUMES,
  randomAvatar,
  wardrobe,
  type Avatar,
} from '@agora/shared';
import { avatarPreviewDataUrl } from '../game/textures';
import { paperPreviewDataUrl, paperFrame, paperMotionFrame } from '../game3d/paperAvatar';
import { motionDuration, motionFrameAt, type AvatarClip } from '../game/avatarMotion';
import type { PaperDir } from '../game3d/paperLayout';
import { Dialog } from './common';
import './avatarEditor.css';

const PREVIEW_MOTIONS = [
  'stand',
  'walk',
  'sit',
  'crouch',
  'idle',
  'talk',
  'sitDown',
  'standUp',
  ...ACTION_KINDS,
  ...EMOTES,
] as const;
type PreviewMotion = (typeof PREVIEW_MOTIONS)[number];

const NEXT_DIR: Record<PaperDir, PaperDir> = {
  down: 'right',
  right: 'up',
  up: 'left',
  left: 'down',
};
const GROUPS = ['character', 'clothes', 'details'] as const;
type Group = (typeof GROUPS)[number];
type Field = { key: keyof Avatar; group: Group; values: readonly string[]; colors?: boolean };
const FIELDS: Field[] = [
  { key: 'gender', group: 'character', values: GENDERS },
  { key: 'skin', group: 'character', values: SKIN_TONES, colors: true },
  { key: 'hair', group: 'character', values: HAIR_STYLES },
  { key: 'hairColor', group: 'character', values: HAIR_COLORS, colors: true },
  { key: 'topStyle', group: 'clothes', values: TOP_STYLES },
  { key: 'top', group: 'clothes', values: TOP_COLORS, colors: true },
  { key: 'bottomStyle', group: 'clothes', values: BOTTOM_STYLES },
  { key: 'bottom', group: 'clothes', values: BOTTOM_COLORS, colors: true },
  { key: 'shoes', group: 'clothes', values: SHOES },
  { key: 'shoeColor', group: 'clothes', values: SHOE_COLORS, colors: true },
  { key: 'vest', group: 'clothes', values: VESTS },
  { key: 'vestColor', group: 'clothes', values: VEST_COLORS, colors: true },
  { key: 'accessory', group: 'details', values: ACCESSORIES },
  { key: 'belt', group: 'details', values: BELTS },
  { key: 'buckle', group: 'details', values: BUCKLES },
  { key: 'costume', group: 'details', values: COSTUMES },
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
  const [a, setA] = useState(() => wardrobe(initial));
  const [name, setName] = useState(initialName);
  const [dir, setDir] = useState<PaperDir>('down');
  const [motion, setMotion] = useState<PreviewMotion>('stand');
  const [playing, setPlaying] = useState(true);
  const [motionFrame, setMotionFrame] = useState(0);
  useEffect(() => {
    if (!playing) return;
    setMotionFrame(0);
    if (motion === 'stand' || motion === 'sit' || motion === 'crouch') return;
    const start = performance.now();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const elapsed = performance.now() - start;
      setMotionFrame(
        motion === 'walk'
          ? [1, 0, 3, 2][Math.floor(elapsed / 130) % 4]!
          : motionFrameAt(
              motion,
              elapsed % motionDuration(motion, dir),
              motionDuration(motion, dir),
              false,
              dir,
            ),
      );
    }, 60);
    return () => window.clearInterval(timer);
  }, [motion, playing, dir]);
  const [group, setGroup] = useState<Group>('character');
  const preview = useMemo(() => avatarPreviewDataUrl(a, 2), [a]);
  const expanded = !['stand', 'walk', 'sit', 'crouch'].includes(motion);
  const paperPreview = useMemo(() => {
    if (motion === 'stand') return paperPreviewDataUrl(a, dir);
    if (motion === 'walk' || motion === 'sit' || motion === 'crouch')
      return paperFrame(a, dir, motion, motionFrame, 2).toDataURL();
    return paperMotionFrame(
      a,
      dir,
      'walk',
      { clip: motion as AvatarClip, frame: motionFrame },
      2,
    ).toDataURL();
  }, [a, dir, motion, motionFrame]);
  const step = (key: keyof Avatar, n: number, d: number) =>
    setA((v) => ({ ...v, [key]: (v[key] + d + n) % n }));
  return (
    <Dialog
      title={t(firstTime ? 'avatar.titleFirst' : 'avatar.title')}
      onClose={onClose}
      wide
      className="wardrobe-dialog"
    >
      <p className="wardrobe-intro">{t('avatar.intro')}</p>
      <div className="avatar-editor">
        <div className="avatar-preview">
          <span className="wardrobe-eyebrow">{t('avatar.livePreview')}</span>
          <div className={`avatar-previews${expanded ? ' avatar-animated' : ''}`}>
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
            <span className="avatar-dir" aria-live="polite">
              {t(`avatar.dir.${dir}`)}
            </span>
          </div>
          <label className="avatar-motion-control">
            <span>{t('avatar.animation')}</span>
            <select
              value={motion}
              onChange={(e) => {
                setMotion(e.target.value as PreviewMotion);
                setPlaying(true);
              }}
            >
              {PREVIEW_MOTIONS.map((clip) => (
                <option key={clip} value={clip}>
                  {t(`avatar.motion.${clip}`)}
                </option>
              ))}
            </select>
          </label>
          {!['stand', 'sit', 'crouch'].includes(motion) && (
            <button
              type="button"
              className="btn secondary"
              aria-pressed={!playing}
              onClick={() => setPlaying((v) => !v)}
            >
              {t(playing ? 'avatar.pause' : 'avatar.play')}
            </button>
          )}
          <button
            type="button"
            className="btn secondary"
            onClick={() => setA(wardrobe(randomAvatar()))}
          >
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
          <div className="wardrobe-groups" role="group" aria-label={t('avatar.categories')}>
            {GROUPS.map((g) => (
              <button type="button" key={g} aria-pressed={group === g} onClick={() => setGroup(g)}>
                {t(`avatar.group.${g}`)}
              </button>
            ))}
          </div>
          <div className="wardrobe-options">
            {FIELDS.filter((f) => f.group === group).map((f) => {
              const val = a[f.key],
                label = t(`avatar.${f.key}`),
                count = f.values.length;
              return (
                <div className="picker" key={f.key} role="group" aria-label={label}>
                  <span className="picker-label">{label}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => step(f.key, count, -1)}
                    aria-label={t('avatar.prev', { what: label })}
                  >
                    <ChevronLeft size={18} aria-hidden />
                  </button>
                  <span className="picker-value" aria-live="polite">
                    {f.colors
                      ? t('avatar.choice', { n: val + 1, total: count })
                      : t(`avatar.opt.${f.values[val]}`)}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => step(f.key, count, 1)}
                    aria-label={t('avatar.next', { what: label })}
                  >
                    <ChevronRight size={18} aria-hidden />
                  </button>
                  {f.colors && (
                    <div className="wardrobe-swatches">
                      {f.values.map((color, i) => (
                        <button
                          key={color}
                          type="button"
                          style={{ backgroundColor: color }}
                          aria-pressed={val === i}
                          aria-label={`${label}: ${t('avatar.choice', { n: i + 1, total: count })}`}
                          onClick={() => setA((v) => ({ ...v, [f.key]: i }))}
                        >
                          {val === i ? <span aria-hidden>✓</span> : null}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="wardrobe-hint">
            {t(group === 'details' ? 'avatar.layerHint' : 'avatar.freedomHint')}
          </p>
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

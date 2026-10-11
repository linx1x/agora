import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SKILLS, type Badge, type Skill } from '@agora/shared';
import { world } from '../net/client';

/** The badge a person shows on their card (P17.31): the skill and the level their own xp has earned. */
export function SkillBadge({ badge }: { badge: Badge }) {
  const { t } = useTranslation();
  return (
    <span className="muted small">
      {t('skill.badge', { skill: t(`skill.${badge.skill}`), level: badge.level })}
    </span>
  );
}

/**
 * The person's own choice of the skill to show (P17.31). A native select: labelled, reachable from
 * the keyboard, with its hint linked to it. The server shows the chosen skill only at a level earned.
 */
export function ShowOffPicker({ badge }: { badge?: Badge }) {
  const { t } = useTranslation();
  const id = useId();
  const [skill, setSkill] = useState<Skill | ''>(badge?.skill ?? '');
  return (
    <div className="show-off">
      <label htmlFor={id} className="small">
        {t('skill.showOff.label')}
      </label>
      <select
        id={id}
        value={skill}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          const next = e.target.value as Skill | '';
          setSkill(next);
          world.send({ t: 'badge', skill: next === '' ? null : next });
        }}
      >
        <option value="">{t('skill.showOff.none')}</option>
        {SKILLS.map((s) => (
          <option key={s} value={s}>
            {t(`skill.${s}`)}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="muted small">
        {t('skill.showOff.hint')}
      </p>
    </div>
  );
}

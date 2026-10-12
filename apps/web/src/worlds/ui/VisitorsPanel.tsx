import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AWAY_RULES, CHOICE_KINDS, type ActionKind, type C2SMsg, type VisitorView } from '@agora/shared';
import { Dialog } from '../../ui/common';
import { world } from '../../net/client';
import { store, useStore } from '../../state/store';
import { toggled } from '../visitorsMath';

type Edit = Extract<C2SMsg, { t: 'world:visitors:set' }>['edit'];
const send = (edit: Edit) => world.send({ t: 'world:visitors:set', edit });


function KindBoxes({
  legend,
  kinds,
  onChange,
}: {
  legend: string;
  kinds: readonly ActionKind[];
  onChange: (next: ActionKind[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="vp-kinds">
      <legend>{legend}</legend>
      {CHOICE_KINDS.map((k) => (
        <label key={k}>
          <input
            type="checkbox"
            checked={kinds.includes(k)}
            onChange={(e) => onChange(toggled(kinds, k, e.target.checked))}
          />{' '}
          {t(`visitors.kind.${k}`)}
        </label>
      ))}
    </fieldset>
  );
}

function Person({ person, defaults }: { person: VisitorView; defaults: readonly ActionKind[] }) {
  const { t } = useTranslation();
  const own = person.grants !== null;
  return (
    <li className="vp-person">
      <div className="vp-person-head">
        <strong>{person.name}</strong>{' '}
        <span className="muted small">{t(person.here ? 'visitors.here' : 'visitors.notHere')}</span>
      </div>
      <label>
        <input
          type="checkbox"
          checked={person.listed}
          onChange={(e) => send({ op: 'list', ref: person.ref, on: e.target.checked })}
        />{' '}
        {t('visitors.listed')}
      </label>
      <label>
        <input
          type="checkbox"
          checked={own}
          onChange={(e) =>
            send({ op: 'person', ref: person.ref, grants: e.target.checked ? [...defaults] : null })
          }
        />{' '}
        {t('visitors.ownGrants')}
      </label>
      {own && (
        <KindBoxes
          legend={t('visitors.personKinds', { name: person.name })}
          kinds={person.grants!}
          onChange={(next) => send({ op: 'person', ref: person.ref, grants: next })}
        />
      )}
      {(person.listed || own) && (
        <button
          type="button"
          className="btn secondary small-btn"
          onClick={() => send({ op: 'forget', ref: person.ref })}
        >
          {t('visitors.forget', { name: person.name })}
        </button>
      )}
    </li>
  );
}

/**
 * Who may do what in my world (P17.27, ADR-053 "Visitors"): what every visitor may do, each
 * person's own permissions, my list, and who may come in while I am away. The server keeps the
 * matrix and checks every action against it; this panel only shows it and asks for changes.
 */
export function VisitorsPanel() {
  const { t } = useTranslation();
  const open = useStore((s) => s.visitorsOpen);
  const view = useStore((s) => s.worldVisitors);
  const refused = useStore((s) => s.visitorsRefused);
  useEffect(() => {
    if (open) world.send({ t: 'world:visitors' });
  }, [open]);
  if (!open) return null;
  const close = () => store.set({ visitorsOpen: false, visitorsRefused: null });
  return (
    <Dialog title={t('visitors.title')} onClose={close} className="wh-panel vp">
      {refused && (
        <p className="wh-notice" role="alert">
          {t(`visitors.refused.${refused}`)}
        </p>
      )}
      {!view ? (
        <p className="muted">…</p>
      ) : (
        <>
          <p className="muted small">{t('visitors.always')}</p>
          <KindBoxes
            legend={t('visitors.defaults')}
            kinds={view.grants}
            onChange={(next) => send({ op: 'defaults', grants: next })}
          />
          <fieldset className="vp-away">
            <legend>{t('visitors.away')}</legend>
            {AWAY_RULES.map((rule) => (
              <label key={rule}>
                <input
                  type="radio"
                  name="vp-away"
                  checked={view.away === rule}
                  onChange={() => send({ op: 'away', rule })}
                />{' '}
                {t(`visitors.awayRule.${rule}`)}
              </label>
            ))}
          </fieldset>
          <h3 className="h-small">{t('visitors.people')}</h3>
          {view.people.length === 0 ? (
            <p className="muted small">{t('visitors.none')}</p>
          ) : (
            <ul className="vp-people">
              {view.people.map((person) => (
                <Person key={person.ref} person={person} defaults={view.grants} />
              ))}
            </ul>
          )}
          <p className="muted small">{t('visitors.privacy')}</p>
        </>
      )}
    </Dialog>
  );
}

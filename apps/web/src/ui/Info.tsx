import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { store } from '../state/store';
import { Dialog } from './common';
import { useTouchControls } from './layout';

interface AssetRow {
  path: string;
  title: string;
  authors: string[];
  license: string;
  source: string;
  modified: boolean;
  notes: string;
}

export function Credits({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AssetRow[] | null>(null);
  useEffect(() => {
    fetch('/assets/registry.json')
      .then((r) => r.json())
      .then((j: { assets: AssetRow[] }) => setRows(j.assets))
      .catch(() => setRows([]));
  }, []);
  return (
    <Dialog title={t('credits.title')} onClose={onClose} wide>
      <p>{t('credits.intro')}</p>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{t('credits.asset')}</th>
            <th scope="col">{t('credits.authors')}</th>
            <th scope="col">{t('credits.license')}</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r) => (
            <tr key={r.path}>
              <td>
                {r.source ? (
                  <a href={r.source} target="_blank" rel="noreferrer noopener">
                    {r.title}
                  </a>
                ) : (
                  r.title
                )}
                {r.notes && <div className="muted small">{r.notes}</div>}
              </td>
              <td>{r.authors.join(', ')}</td>
              <td>{r.license}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

export function Privacy({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const items = [
    'collected',
    'notStored',
    'floor',
    'rooms',
    'media',
    'retention',
    'contact',
  ] as const;
  return (
    <Dialog title={t('privacy.title')} onClose={onClose} wide>
      <p>{t('privacy.intro')}</p>
      {items.map((k) => (
        <section key={k}>
          <h3 className="h-small">{t(`privacy.${k}.h`)}</h3>
          <p>{t(`privacy.${k}.p`)}</p>
        </section>
      ))}
    </Dialog>
  );
}

export function Shortcuts({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const touch = useTouchControls();
  const rows: [string, string][] = [
    ['W A S D / ← ↑ → ↓', 'shortcuts.move'],
    ['1 – 6', 'shortcuts.emotes'],
    ['M', 'shortcuts.mic'],
    ['V', 'shortcuts.cam'],
    ['Entrée / Enter', 'shortcuts.chat'],
    ['P', 'shortcuts.people'],
    ['X', 'shortcuts.act'],
    ['H', 'shortcuts.desk'],
    ['N', 'shortcuts.minimap'],
    ...(store.get().builder ? [['B', 'shortcuts.build'] as [string, string]] : []),
    ['+ / −', 'shortcuts.zoom'],
    ['Clic / Click', 'shortcuts.click'],
    ['?', 'shortcuts.help'],
    ['Échap / Esc', 'shortcuts.close'],
  ];
  const { pushToTalk, pttKey } = store.get().settings;
  if (pushToTalk) rows.splice(3, 0, [t(`settings.key${pttKey}`), 'shortcuts.ptt']);
  // touch screens (P8.2): gestures first, the keyboard list stays for a paired keyboard
  const gestures = ['tap', 'joystick', 'pinch', 'act', 'sheet'];
  if (pushToTalk) gestures.push('ptt');
  return (
    <Dialog title={t(touch ? 'touch.helpTitle' : 'shortcuts.title')} onClose={onClose}>
      {touch && (
        <>
          <h3 className="h-small">{t('touch.gestures')}</h3>
          <dl className="shortcuts gestures">
            {gestures.map((g) => (
              <div key={g}>
                <dt>{t(`touch.${g}Key`)}</dt>
                <dd>{t(`touch.${g}`)}</dd>
              </div>
            ))}
          </dl>
          <h3 className="h-small">{t('shortcuts.title')}</h3>
        </>
      )}
      <dl className="shortcuts">
        {rows.map(([k, v]) => (
          <div key={v}>
            <dt>
              <kbd>{k}</kbd>
            </dt>
            <dd>{t(v)}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

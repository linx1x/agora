import { useTranslation } from 'react-i18next';
import { BellRing, DoorOpen, Footprints, Sparkles, X } from 'lucide-react';
import { world } from '../net/client';
import { store, useStore } from '../state/store';
import { useTouchControls } from './layout';

/** Contextual actions near the bottom centre: sit/stand, claim, knock, teleport; incoming knocks and call-overs. */
export function PromptBar() {
  const { t, i18n } = useTranslation();
  const prompt = useStore((s) => s.prompt);
  const knocks = useStore((s) => s.knocks);
  const callover = useStore((s) => s.callover);
  const map = useStore((s) => s.map);
  const fr = i18n.language.startsWith('fr');
  /** no X key on a touch screen: prompts get a button instead (P8.2) */
  const touch = useTouchControls();
  const act = () => store.set({ navRequest: { kind: 'act' } });
  const regionName = (id: string) => {
    const r = map?.regions.find((q) => q.id === id);
    return r ? (fr ? r.nameFr : r.nameEn) : id;
  };

  return (
    <div className="prompt-stack" aria-live="polite">
      {knocks.map((k) => (
        <div
          key={k.from}
          className="prompt-card"
          role="alertdialog"
          aria-label={t('knock.incoming', { name: k.name })}
        >
          <BellRing size={16} aria-hidden />
          <span>{t('knock.incoming', { name: k.name })}</span>
          <button
            type="button"
            className="btn primary small-btn"
            onClick={() => {
              world.send({ t: 'knock:answer', visitor: k.from, accept: true });
              store.set((s) => ({ knocks: s.knocks.filter((q) => q.from !== k.from) }));
            }}
          >
            {t('knock.letIn')}
          </button>
          <button
            type="button"
            className="btn secondary small-btn"
            onClick={() => {
              world.send({ t: 'knock:answer', visitor: k.from, accept: false });
              store.set((s) => ({ knocks: s.knocks.filter((q) => q.from !== k.from) }));
            }}
          >
            {t('knock.notNow')}
          </button>
        </div>
      ))}
      {callover && (
        <div
          className="prompt-card"
          role="alertdialog"
          aria-label={t('callover.incoming', { name: callover.name })}
        >
          <Sparkles size={16} aria-hidden />
          <span>{t('callover.incoming', { name: callover.name })}</span>
          <button
            type="button"
            className="btn primary small-btn"
            onClick={() =>
              store.set({ callover: null, navRequest: { kind: 'person', id: callover.from } })
            }
          >
            <Footprints size={14} aria-hidden /> {t('callover.go')}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('common.dismiss')}
            onClick={() => store.set({ callover: null })}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      )}
      {prompt && (
        <div className="prompt-card hint">
          {(prompt.kind === 'sit' || prompt.kind === 'stand') &&
            (touch ? (
              <button type="button" className="btn primary small-btn" onClick={act}>
                {t(prompt.kind === 'sit' ? 'prompt.sitBtn' : 'prompt.standBtn')}
              </button>
            ) : (
              <span>{t(prompt.kind === 'sit' ? 'prompt.sit' : 'prompt.stand')}</span>
            ))}
          {prompt.kind === 'claim' && (
            <>
              <span>{t(prompt.moving ? 'prompt.claimMove' : 'prompt.claim')}</span>
              <button
                type="button"
                className="btn primary small-btn"
                onClick={() => world.send({ t: 'desk:claim', deskId: prompt.deskId })}
              >
                {t(prompt.moving ? 'desk.moveHere' : 'desk.claim')}
              </button>
            </>
          )}
          {prompt.kind === 'knock' && (
            <>
              <DoorOpen size={16} aria-hidden />
              <span>{t(touch ? 'prompt.knockTouch' : 'prompt.knock', { name: prompt.owner })}</span>
              <button
                type="button"
                className="btn primary small-btn"
                onClick={() => world.send({ t: 'knock', deskId: prompt.deskId })}
              >
                {t('knock.knock')}
              </button>
            </>
          )}
          {prompt.kind === 'closed' && <span>{t('prompt.closed', { name: prompt.owner })}</span>}
          {prompt.kind === 'teleport' && (
            <>
              <span>{t('prompt.teleport')}</span>
              <div className="teleport-menu" role="group" aria-label={t('prompt.teleport')}>
                {(map?.regions ?? [])
                  .filter((r) => r.id !== prompt.region)
                  .map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`btn small-btn ${r.id === prompt.to ? 'primary' : 'secondary'}`}
                      onClick={() => world.send({ t: 'teleport', to: r.id })}
                    >
                      {regionName(r.id)}
                      {r.id === prompt.to && !touch ? ' (X)' : ''}
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircle, X } from 'lucide-react';
import { NPC_TALK_MAX_LEN } from '@agora/shared';
import { world } from '../net/client';
import { store, useStore } from '../state/store';
import { GiftPicker } from './GiftPicker';

/** How long a refusal stays on screen. */
const REFUSAL_MS = 6000;
/** A reply that has not come after this long no longer blocks the next message. */
const WAIT_MS = 25000;

/**
 * The Talk box (P15.4, ADR-045): a message to the character beside you. Nearby chat between people
 * never goes to a character; only what is written here does, and only after the AI notice is accepted
 * when a cloud model is configured. My own lines stay in this browser.
 */
export function TalkBox() {
  const { t, i18n } = useTranslation();
  const talkTo = useStore((s) => s.talkTo);
  const npc = useStore((s) => s.npcs.find((n) => n.id === s.talkTo));
  const consent = useStore((s) => s.npcConsent);
  const log = useStore((s) => s.npcLog);
  const typing = useStore((s) => (s.talkTo ? s.npcTyping[s.talkTo] === true : false));
  const refused = useStore((s) => s.npcRefused);
  const profiles = useStore((s) => s.profiles);
  const npcs = useStore((s) => s.npcs);
  const memoryOn = useStore((s) => s.config?.flags.npcMemory === true);
  // P17.26b: the box also opens for gifts alone, when personal worlds are on and Talk is off
  const chatOn = useStore((s) => s.config?.flags.npcTalk === true);
  const giftOn = useStore((s) => s.config?.flags.worlds === true);
  const remembered = useStore((s) => (s.talkTo ? s.npcMemory[s.talkTo] : undefined));
  const [text, setText] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);
  const logEl = useRef<HTMLDivElement>(null);
  const needsNotice = chatOn && !!consent?.needed && !consent.ok;

  const lines = useMemo(() => log.filter((l) => l.npcId === talkTo).slice(-12), [log, talkTo]);
  const last = lines.at(-1);
  const waiting = last?.from === 'me' && now - last.at < WAIT_MS;

  useEffect(() => {
    if (!talkTo) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [talkTo]);
  const accept = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (talkTo) (needsNotice ? accept.current : input.current)?.focus();
  }, [talkTo, needsNotice]);
  // Escape closes the box wherever the focus is (it can be on the page after a button went away)
  useEffect(() => {
    if (!talkTo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      store.set({ talkTo: null });
      (document.activeElement as HTMLElement | null)?.blur?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [talkTo]);
  useEffect(() => {
    logEl.current?.scrollTo?.({ top: logEl.current.scrollHeight });
  }, [lines.length]);

  if (!talkTo || !npc) return null;
  const close = () => {
    store.set({ talkTo: null });
    (document.activeElement as HTMLElement | null)?.blur?.();
  };
  const country = consent
    ? (() => {
        try {
          return new Intl.DisplayNames([i18n.language], { type: 'region' }).of(consent.country);
        } catch {
          return consent.country;
        }
      })()
    : '';
  const reason =
    refused && refused.id === talkTo && Date.now() - refused.at < REFUSAL_MS
      ? refused.reason
      : null;

  const send = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || waiting) return;
    world.send({ t: 'npc:talk', npcId: talkTo, body });
    store.set((s) => ({
      npcRefused: null,
      npcLog: [
        ...s.npcLog.slice(-59),
        { id: `me-${Date.now()}`, npcId: talkTo, from: 'me' as const, body, at: Date.now() },
      ],
    }));
    setText('');
    setNow(Date.now());
  };

  return (
    <section className="talkbox" role="dialog" aria-label={t('talk.title', { name: npc.name })}>
      <header>
        <MessageCircle size={16} aria-hidden />
        <h2>{t('talk.title', { name: npc.name })}</h2>
        <span className="npc-tag">{t('npc.bot')}</span>
        <button type="button" className="icon-btn" aria-label={t('talk.close')} onClick={close}>
          <X size={16} aria-hidden />
        </button>
      </header>

      {!chatOn ? null : needsNotice && consent ? (
        <div className="talk-notice">
          <h3>{t('talk.notice.title')}</h3>
          <p>
            {t('talk.notice.body', {
              provider: consent.provider,
              country: country ?? consent.country,
            })}
          </p>
          {consent.web && <p>{t('talk.notice.web')}</p>}
          <p className="muted small">{t('talk.notice.rules')}</p>
          <div className="row">
            <button
              ref={accept}
              type="button"
              className="btn primary small-btn"
              onClick={() => world.send({ t: 'npc:consent', accept: true })}
            >
              {t('talk.notice.accept')}
            </button>
            <button type="button" className="btn secondary small-btn" onClick={close}>
              {t('talk.notice.decline')}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            className="talk-log"
            ref={logEl}
            role="log"
            aria-live="polite"
            aria-label={t('talk.log')}
            tabIndex={0}
          >
            {lines.length === 0 && (
              <p className="muted small">{t('talk.empty', { name: npc.name })}</p>
            )}
            {lines.map((l) => (
              <p key={l.id} className={l.from === 'me' ? 'mine' : 'theirs'}>
                <strong>
                  {l.from === 'me'
                    ? t('talk.you')
                    : l.to
                      ? t('talk.toOther', {
                          name: npc.name,
                          to: profiles[l.to]?.name ?? npcs.find((q) => q.id === l.to)?.name ?? '…',
                        })
                      : npc.name}
                </strong>{' '}
                {l.body}
                {l.src?.length ? (
                  <span className="muted small talk-src">
                    {' '}
                    {t('talk.web.sources', { sites: l.src.join(', ') })}
                  </span>
                ) : null}
              </p>
            ))}
            {typing && (
              <p className="muted small" role="status">
                {t('talk.typing', { name: npc.name })}
              </p>
            )}
            {reason && reason !== 'consent' && (
              <p className="talk-refused" role="alert">
                {t(`talk.refused.${reason}`, { name: npc.name })}
              </p>
            )}
          </div>
          <form onSubmit={send} className="talk-form">
            <label className="sr-only" htmlFor="talk-input">
              {t('talk.label', { name: npc.name })}
            </label>
            <input
              id="talk-input"
              ref={input}
              value={text}
              maxLength={NPC_TALK_MAX_LEN}
              placeholder={t('talk.placeholder', { name: npc.name })}
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
            />
            <button
              type="submit"
              className="btn primary small-btn"
              disabled={!text.trim() || waiting}
            >
              {t('talk.send')}
            </button>
          </form>
          {memoryOn && (
            <details
              className="talk-memory"
              onToggle={(e) => {
                if ((e.currentTarget as HTMLDetailsElement).open)
                  world.send({ t: 'npc:recall', npcId: talkTo });
              }}
            >
              <summary>{t('talk.memory.title', { name: npc.name })}</summary>
              <p className="small" role="status">
                {remembered === undefined
                  ? '…'
                  : remembered || t('talk.memory.none', { name: npc.name })}
              </p>
              <p className="muted small">{t('talk.memory.about')}</p>
              <button
                type="button"
                className="btn secondary small-btn"
                onClick={() => world.send({ t: 'npc:forget' })}
              >
                {t('talk.memory.forget')}
              </button>
            </details>
          )}
          <p className="muted small talk-hint">
            {t('talk.hint', { name: npc.name })}
            {consent?.needed && consent.ok && (
              <>
                {' '}
                <button
                  type="button"
                  className="linklike"
                  onClick={() => world.send({ t: 'npc:consent', accept: false })}
                >
                  {t('talk.notice.withdraw')}
                </button>
              </>
            )}
          </p>
        </>
      )}
      {giftOn && <GiftPicker npcId={talkTo} name={npc.name} />}
    </section>
  );
}

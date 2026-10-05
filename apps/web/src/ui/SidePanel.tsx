import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { BellRing, Crosshair, Footprints, Mic, MicOff, Send, Video, X } from 'lucide-react';
import { useCompactLayout } from './layout';
import type { ChatMsg } from '@agora/shared';
import { avatarUrl } from '../game/textures';
import { zoneName } from '../game/WorldScene';
import { world } from '../net/client';
import { store, useStore } from '../state/store';

function People() {
  const { t } = useTranslation();
  const profiles = useStore((s) => s.profiles);
  const areas = useStore((s) => s.areas);
  const me = useStore((s) => s.me);
  const compact = useCompactLayout();
  /** on phones the sheet covers the world: close it so you see where you go */
  const hide = compact ? { panelOpen: false } : {};
  const [q, setQ] = useState('');
  const list = Object.values(profiles)
    .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name)));
  return (
    <div className="panel-section">
      <label className="field compact">
        <span className="sr-only">{t('people.search')}</span>
        <input
          type="search"
          placeholder={t('people.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      <p className="muted small" aria-live="polite">
        {t('people.count', { count: Object.keys(profiles).length })}
      </p>
      <ul className="people">
        {list.map((p) => (
          <li key={p.id} className={p.online ? '' : 'offline'}>
            <img src={avatarUrl(p.avatar)} alt="" width={32} height={40} className="pixel" />
            <div className="person">
              <div className="person-name">
                <span
                  className={`status-dot ${p.status}`}
                  aria-label={t(`status.${p.status}`)}
                  role="img"
                />
                {p.name}
                {p.id === me && <span className="muted"> ({t('people.you')})</span>}
                {p.hand && (
                  <span role="img" aria-label={t('emote.hand')}>
                    {' '}
                    ✋
                  </span>
                )}
              </div>
              <div className="muted small">
                {p.online ? zoneName(areas[p.id]) : t('people.reconnecting')}
                {p.statusMsg ? ` · ${p.statusMsg}` : ''}
              </div>
            </div>
            <span className="person-icons">
              {p.mic ? (
                <Mic size={14} aria-label={t('people.micOn')} />
              ) : (
                <MicOff size={14} aria-label={t('people.micOff')} />
              )}
              {p.cam && <Video size={14} aria-label={t('people.camOn')} />}
            </span>
            {p.id !== me && p.online && (
              <span className="person-actions">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => store.set({ navRequest: { kind: 'person', id: p.id }, ...hide })}
                  aria-label={t('people.goto', { name: p.name })}
                  title={t('people.goto', { name: p.name })}
                >
                  <Footprints size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => world.send({ t: 'callover', to: p.id })}
                  aria-label={t('people.callover', { name: p.name })}
                  title={t('people.callover', { name: p.name })}
                >
                  <BellRing size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => store.set({ locate: p.id, ...hide })}
                  aria-label={t('people.locate', { name: p.name })}
                  title={t('people.locate', { name: p.name })}
                >
                  <Crosshair size={16} aria-hidden />
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chat() {
  const { t, i18n } = useTranslation();
  const tab = useStore((s) => s.chatTab);
  const chat = useStore((s) => s.chat);
  const unread = useStore((s) => s.unread);
  const me = useStore((s) => s.me);
  const myZone = useStore((s) => s.myZone);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const msgs = useMemo(() => chat.filter((m) => m.scope === tab), [chat, tab]);
  useEffect(() => {
    store.set((s) => ({ unread: { ...s.unread, [tab]: 0 } }));
  }, [tab, msgs.length]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, tab]);
  const send = (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    world.send({ t: 'chat', scope: tab, body });
    setDraft('');
  };
  const fmt = (m: ChatMsg) =>
    new Intl.DateTimeFormat(i18n.language === 'fr' ? 'fr-CA' : 'en-CA', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(m.at);
  const hint =
    tab === 'everyone'
      ? t('chat.hintEveryone')
      : myZone?.kind === 'private'
        ? t('chat.hintRoom')
        : t('chat.hintNearby');
  return (
    <div className="panel-section chat">
      <div className="tabs small-tabs" role="tablist" aria-label={t('chat.channels')}>
        {(['nearby', 'everyone'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            className="tab"
            onClick={() => store.set({ chatTab: k })}
          >
            {t(`chat.${k}`)}
            {unread[k] > 0 && tab !== k && (
              <span className="badge" aria-label={t('chat.unread', { count: unread[k] })}>
                {unread[k]}
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="muted small">{hint}</p>
      <ol className="messages" ref={listRef} aria-live="polite" aria-relevant="additions">
        {msgs.length === 0 && <li className="muted small empty">{t('chat.empty')}</li>}
        {msgs.map((m) => (
          <li key={m.id} className={m.from === me ? 'mine' : ''}>
            <div className="msg-meta">
              <strong>{m.name}</strong> <time className="muted small">{fmt(m)}</time>
            </div>
            <div className="msg-body">{m.body}</div>
          </li>
        ))}
      </ol>
      <form onSubmit={send} className="chat-form">
        <label className="sr-only" htmlFor="chat-input">
          {t('chat.placeholder')}
        </label>
        <input
          id="chat-input"
          value={draft}
          maxLength={1000}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t(tab === 'everyone' ? 'chat.placeholderEveryone' : 'chat.placeholder')}
          autoComplete="off"
          enterKeyHint="send"
          onKeyDown={(e) => {
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
        />
        <button type="submit" className="icon-btn primary" aria-label={t('chat.send')}>
          <Send size={16} aria-hidden />
        </button>
      </form>
    </div>
  );
}

export function SidePanel() {
  const { t } = useTranslation();
  const panel = useStore((s) => s.panel);
  const open = useStore((s) => s.panelOpen);
  const unread = useStore((s) => s.unread);
  const compact = useCompactLayout();
  const drag = useRef<{ y: number; id: number } | null>(null);
  const [dy, setDy] = useState(0);
  const total = unread.nearby + unread.everyone;
  if (!open) return null;
  const close = () => store.set({ panelOpen: false });
  return (
    <aside
      className={`side-panel${compact ? ' sheet-panel' : ''}`}
      aria-label={t('panel.label')}
      style={dy ? { transform: `translateY(${dy}px)` } : undefined}
      onKeyDown={(e) => {
        if (compact && e.key === 'Escape' && !(e.target as HTMLElement).closest('input')) close();
      }}
    >
      {compact && (
        // Phones (P8.2): drag the handle down to close; the button does the same.
        <div
          className="sheet-head"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            drag.current = { y: e.clientY, id: e.pointerId };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (drag.current?.id === e.pointerId) setDy(Math.max(0, e.clientY - drag.current.y));
          }}
          onPointerUp={(e) => {
            if (drag.current?.id !== e.pointerId) return;
            const far = e.clientY - drag.current.y > 80;
            drag.current = null;
            setDy(0);
            if (far) close();
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDy(0);
          }}
        >
          <span className="sheet-grip" aria-hidden />
          <button
            type="button"
            className="icon-btn sheet-close"
            onClick={close}
            aria-label={t('common.close')}
          >
            <X size={18} aria-hidden />
          </button>
        </div>
      )}
      <div className="tabs" role="tablist">
        <button
          role="tab"
          type="button"
          aria-selected={panel === 'people'}
          className="tab"
          onClick={() => store.set({ panel: 'people' })}
        >
          {t('panel.people')}
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={panel === 'chat'}
          className="tab"
          onClick={() => store.set({ panel: 'chat' })}
        >
          {t('panel.chat')}
          {total > 0 && panel !== 'chat' && (
            <span className="badge" aria-label={t('chat.unread', { count: total })}>
              {total}
            </span>
          )}
        </button>
      </div>
      {panel === 'people' ? <People /> : <Chat />}
    </aside>
  );
}

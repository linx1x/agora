import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, KeyRound, LogOut, Pencil, Plus, Trash2 } from 'lucide-react';
import { deviceLabel, type PasskeySummary, type SessionSummary } from '@agora/shared';
import { api } from '../net/api';
import { addPasskey, withStepUp, type PasskeyError } from '../net/passkey';
import { useStore } from '../state/store';
import { Dialog } from './common';

export const useDate = () => {
  const { i18n } = useTranslation();
  return (ms: number, withTime = true) =>
    new Intl.DateTimeFormat(i18n.language === 'fr' ? 'fr-CA' : 'en-CA', {
      dateStyle: 'medium',
      ...(withTime ? { timeStyle: 'short' } : {}),
    }).format(ms);
};

/**
 * My account (PLAN P2.17): my passkeys (add, rename, remove — never the last one) and my
 * sessions (sign one out, or all the others).
 */
export function Account({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const date = useDate();
  const role = useStore((s) => s.role);
  const invitedName = useStore((s) => s.invitedName);
  const [keys, setKeys] = useState<PasskeySummary[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  /** passkey waiting for "yes, remove it" */
  const [confirming, setConfirming] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [k, s] = await Promise.all([
      api<{ passkeys: PasskeySummary[] }>('GET', '/api/me/passkeys'),
      api<{ sessions: SessionSummary[] }>('GET', '/api/me/sessions'),
    ]);
    setKeys(k.data?.passkeys ?? []);
    setSessions(s.data?.sessions ?? []);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const fail = (e: PasskeyError | string | null) =>
    setMsg({
      text: t(`auth.error.${e ?? 'failed'}`, { defaultValue: t('auth.error.failed') }),
      error: e !== 'cancelled',
    });

  const add = async () => {
    setBusy(true);
    setMsg(null);
    const r = await addPasskey();
    setBusy(false);
    if (r.ok) setMsg({ text: t('account.ok') });
    else fail(r.error);
    void reload();
  };
  const rename = async (e: FormEvent, id: string) => {
    e.preventDefault();
    const r = await api('PATCH', `/api/me/passkeys/${encodeURIComponent(id)}`, {
      label: label.trim(),
    });
    if (!r.ok) fail(r.error);
    setEditing(null);
    void reload();
  };
  const remove = async (id: string) => {
    setConfirming(null);
    const r = await withStepUp(() => api('DELETE', `/api/me/passkeys/${encodeURIComponent(id)}`));
    if (r.ok) setMsg({ text: t('account.ok') });
    else fail(r.error);
    void reload();
  };
  const signOut = async (s: SessionSummary) => {
    await api('DELETE', `/api/me/sessions/${encodeURIComponent(s.id)}`);
    if (s.current) location.reload();
    else void reload();
  };
  const signOutOthers = async () => {
    const r = await api<{ revoked: number }>('POST', '/api/me/sessions/revoke-others');
    setMsg({ text: t('account.signedOutOthers', { count: r.data?.revoked ?? 0 }) });
    void reload();
  };

  return (
    <Dialog title={t('account.title')} onClose={onClose} wide>
      <div className="stack">
        <p>
          {t('account.role', { role: t(`role.${role}`) })}
          {invitedName && (
            <span className="muted small"> · {t('account.invitedAs', { name: invitedName })}</span>
          )}
        </p>
        <p className="small status-line" role="status">
          {msg && <span className={msg.error ? 'error' : undefined}>{msg.text}</span>}
        </p>

        <section className="stack" aria-labelledby="keys-h">
          <h3 id="keys-h" className="h-small">
            {t('account.passkeys')}
          </h3>
          <p className="muted small">{t('account.passkeysIntro')}</p>
          <ul className="item-list">
            {keys.map((k) => (
              <li key={k.id} className="item">
                <KeyRound size={18} aria-hidden />
                <div className="item-main">
                  {editing === k.id ? (
                    <form className="row" onSubmit={(e) => void rename(e, k.id)}>
                      <label className="sr-only" htmlFor={`label-${k.id}`}>
                        {t('account.label')}
                      </label>
                      <input
                        id={`label-${k.id}`}
                        value={label}
                        maxLength={40}
                        onChange={(e) => setLabel(e.target.value)}
                        autoFocus
                        required
                      />
                      <button type="submit" className="btn secondary small-btn">
                        {t('account.save')}
                      </button>
                      <button
                        type="button"
                        className="btn ghost small-btn"
                        onClick={() => setEditing(null)}
                      >
                        {t('account.cancel')}
                      </button>
                    </form>
                  ) : (
                    <strong>{k.label || '—'}</strong>
                  )}
                  <span className="muted small">
                    {t('account.added', { date: date(k.createdAt, false) })} ·{' '}
                    {t('account.lastUsed', {
                      date: k.lastUsedAt ? date(k.lastUsedAt) : t('account.never'),
                    })}
                    {k.backedUp && (
                      <span className="tag" title={t('account.syncedHint')}>
                        <Cloud size={12} aria-hidden /> {t('account.synced')}
                      </span>
                    )}
                  </span>
                </div>
                {confirming === k.id && (
                  <div className="confirm-row" role="group" aria-label={t('account.removeConfirm')}>
                    <span className="small">{t('account.removeConfirm')}</span>
                    <button
                      type="button"
                      className="btn danger small-btn"
                      onClick={() => void remove(k.id)}
                    >
                      {t('account.remove')}
                    </button>
                    <button
                      type="button"
                      className="btn ghost small-btn"
                      onClick={() => setConfirming(null)}
                    >
                      {t('account.cancel')}
                    </button>
                  </div>
                )}
                {editing !== k.id && confirming !== k.id && (
                  <>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('account.renameNamed', { name: k.label })}
                      title={t('account.rename')}
                      onClick={() => {
                        setEditing(k.id);
                        setLabel(k.label);
                      }}
                    >
                      <Pencil size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('account.removeNamed', { name: k.label })}
                      title={t('account.remove')}
                      disabled={keys.length <= 1}
                      onClick={() => setConfirming(k.id)}
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn secondary"
            onClick={() => void add()}
            disabled={busy}
          >
            <Plus size={16} aria-hidden />
            <span>{t('account.add')}</span>
          </button>
          <p className="muted small">{t('account.addHint')}</p>
        </section>

        <section className="stack" aria-labelledby="sessions-h">
          <h3 id="sessions-h" className="h-small">
            {t('account.sessions')}
          </h3>
          <p className="muted small">{t('account.sessionsIntro')}</p>
          <ul className="item-list">
            {sessions.map((s) => {
              const name = deviceLabel(s.userAgent);
              return (
                <li key={s.id} className="item">
                  <div className="item-main">
                    <strong>
                      {name}
                      {s.current && <span className="tag">{t('account.thisDevice')}</span>}
                    </strong>
                    <span className="muted small">
                      {t('account.lastUsed', { date: date(s.lastUsedAt) })} ·{' '}
                      {t('account.until', { date: date(s.expiresAt) })}
                      {s.shared && ` · ${t('account.sharedSession')}`}
                      {s.ip && ` · ${s.ip}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('account.signOutNamed', { name })}
                    title={t('account.signOut')}
                    onClick={() => void signOut(s)}
                  >
                    <LogOut size={16} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
          {sessions.length > 1 && (
            <button type="button" className="btn ghost" onClick={() => void signOutOthers()}>
              {t('account.signOutOthers')}
            </button>
          )}
        </section>
      </div>
    </Dialog>
  );
}

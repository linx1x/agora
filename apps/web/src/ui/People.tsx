import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Trash2 } from 'lucide-react';
import {
  ASSIGNABLE_ROLES,
  DEFAULT_INVITE_HOURS,
  INVITE_EXPIRY_HOURS,
  MAX_NAME_LEN,
  type AccountInviteSummary,
  type AssignableRole,
  type CreatedLink,
  type PersonSummary,
  type SpaceSummary,
} from '@agora/shared';
import { api } from '../net/api';
import { useStore } from '../state/store';
import { useDate } from './Account';
import { Dialog } from './common';

/**
 * The owner's People page (PLAN P2.15, P2.16): create invites (link + PIN shown once),
 * follow and revoke them, and manage accounts — role, name, invite-only spaces, sessions,
 * recovery links, removal. The server checks every action again.
 */
export function People({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'invites' | 'people'>('invites');
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);

  const reloadPeople = useCallback(async () => {
    const r = await api<{ people: PersonSummary[] }>('GET', '/api/admin/people');
    setPeople(r.data?.people ?? []);
  }, []);
  useEffect(() => {
    void reloadPeople();
    void api<{ spaces: SpaceSummary[] }>('GET', '/api/spaces').then((r) =>
      setSpaces((r.data?.spaces ?? []).filter((s) => s.access === 'invite')),
    );
  }, [reloadPeople]);

  const tabBtn = (id: 'invites' | 'people', label: string) => (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={tab === id}
      aria-controls={`panel-${id}`}
      tabIndex={tab === id ? 0 : -1}
      className="tab"
      onClick={() => {
        setTab(id);
        void reloadPeople();
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const next = tab === 'invites' ? 'people' : 'invites';
          setTab(next);
          void reloadPeople();
          document.getElementById(`tab-${next}`)?.focus();
        }
      }}
    >
      {label}
    </button>
  );

  return (
    <Dialog title={t('admin.title')} onClose={onClose} wide>
      <div className="tabs" role="tablist" aria-label={t('admin.title')}>
        {tabBtn('invites', t('admin.tabInvites'))}
        {tabBtn('people', t('admin.tabPeople'))}
      </div>
      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="stack tab-body"
      >
        {tab === 'invites' ? (
          <Invites people={people} spaces={spaces} onChange={() => void reloadPeople()} />
        ) : (
          <Members people={people} spaces={spaces} onChange={() => void reloadPeople()} />
        )}
      </div>
    </Dialog>
  );
}

/** Link (and PIN) shown once, with copy buttons. */
function SecretBox({ made, title }: { made: CreatedLink; title: string }) {
  const { t } = useTranslation();
  const url = `${location.origin}${made.path}`;
  const ref = useRef<HTMLDivElement>(null);
  // bring the one-time secrets into view (they appear below the form)
  useEffect(() => {
    ref.current?.scrollIntoView({
      block: 'nearest',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [made]);
  return (
    <div className="invite-link secret-box" role="status" ref={ref}>
      <p>
        <strong>{title}</strong>
      </p>
      <CopyField label={t('admin.link')} value={url} id="made-link" />
      {made.pin && <CopyField label={t('admin.pinCode')} value={made.pin} id="made-pin" mono />}
      <p className="muted small">
        {made.pin ? t('admin.pinHint') : t('admin.openHint')} {t('admin.shownOnce')}
      </p>
    </div>
  );
}

function CopyField({
  label,
  value,
  id,
  mono,
}: {
  label: string;
  value: string;
  id: string;
  mono?: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      (document.getElementById(id) as HTMLInputElement | null)?.select();
    }
  };
  return (
    <label className="field">
      <span>{label}</span>
      <span className="row">
        <input
          id={id}
          readOnly
          value={value}
          className={mono ? 'mono' : undefined}
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className="btn secondary" onClick={() => void copy()}>
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          <span>{t(copied ? 'admin.copied' : 'admin.copy')}</span>
        </button>
      </span>
    </label>
  );
}

function SpacePicker({
  spaces,
  value,
  onChange,
  legend,
}: {
  spaces: SpaceSummary[];
  value: string[];
  onChange: (v: string[]) => void;
  legend: string;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="fieldset">
      <legend>{legend}</legend>
      {spaces.length === 0 ? (
        <p className="muted small">{t('admin.spacesNone')}</p>
      ) : (
        spaces.map((s) => (
          <label key={s.id} className="check">
            <input
              type="checkbox"
              checked={value.includes(s.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, s.id] : value.filter((x) => x !== s.id))
              }
            />
            <span>{s.name}</span>
          </label>
        ))
      )}
    </fieldset>
  );
}

function Invites({
  people,
  spaces,
  onChange,
}: {
  people: PersonSummary[];
  spaces: SpaceSummary[];
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const date = useDate();
  const [list, setList] = useState<AccountInviteSummary[]>([]);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [role, setRole] = useState<AssignableRole>('member');
  const [picked, setPicked] = useState<string[]>([]);
  const [hours, setHours] = useState<number>(DEFAULT_INVITE_HOURS);
  const [protection, setProtection] = useState<'pin' | 'open'>('pin');
  const [pilotUid, setPilotUid] = useState('');
  const [made, setMade] = useState<CreatedLink | null>(null);
  const [error, setError] = useState(false);
  const pilots = people.filter((p) => p.pilot);

  const reload = useCallback(async () => {
    const r = await api<{ invites: AccountInviteSummary[] }>('GET', '/api/admin/invites');
    setList(r.data?.invites ?? []);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(false);
    const r = await api<CreatedLink>('POST', '/api/admin/invites', {
      name: name.trim(),
      note: note.trim(),
      role,
      spaces: picked,
      expiresInHours: hours,
      protection,
      pilotUid: pilotUid || null,
    });
    if (!r.data) return setError(true);
    setMade(r.data);
    setName('');
    setNote('');
    setPicked([]);
    setPilotUid('');
    void reload();
    onChange();
  };
  const revoke = async (id: string) => {
    await api('DELETE', `/api/admin/invites/${encodeURIComponent(id)}`);
    void reload();
  };
  const duration = (h: number) =>
    h < 24 ? t('admin.hours', { count: h }) : t('admin.days', { count: h / 24 });
  const nameOf = (uid: string | null) => people.find((p) => p.uid === uid)?.name ?? uid ?? '';

  return (
    <>
      <form className="stack" onSubmit={(e) => void create(e)} aria-labelledby="new-invite-h">
        <h3 id="new-invite-h" className="h-small">
          {t('admin.newInvite')}
        </h3>
        <div className="grid-2">
          <label className="field compact">
            <span>{t('admin.name')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LEN}
              required
            />
          </label>
          <label className="field compact">
            <span>{t('admin.note')}</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={120}
              placeholder={t('admin.notePlaceholder')}
            />
          </label>
          <label className="field compact">
            <span>{t('admin.role')}</span>
            <select value={role} onChange={(e) => setRole(e.target.value as AssignableRole)}>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field compact">
            <span>{t('admin.expires')}</span>
            <select value={String(hours)} onChange={(e) => setHours(Number(e.target.value))}>
              {INVITE_EXPIRY_HOURS.map((h) => (
                <option key={h} value={String(h)}>
                  {duration(h)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">{t(`role.${role}Hint`)}</p>
        <SpacePicker
          spaces={spaces}
          value={picked}
          onChange={setPicked}
          legend={t('admin.spaces')}
        />
        <fieldset className="fieldset">
          <legend>{t('admin.protection')}</legend>
          {(['pin', 'open'] as const).map((p) => (
            <label key={p} className="check">
              <input
                type="radio"
                name="protection"
                value={p}
                checked={protection === p}
                onChange={() => setProtection(p)}
              />
              <span>
                {t(`admin.${p}`)}
                <span className="muted small"> {t(`admin.${p}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {pilots.length > 0 && (
          <label className="field compact">
            <span>{t('admin.pilot')}</span>
            <select
              value={pilotUid}
              onChange={(e) => setPilotUid(e.target.value)}
              aria-describedby="pilot-hint"
            >
              <option value="">{t('admin.pilotNone')}</option>
              {pilots.map((p) => (
                <option key={p.uid} value={p.uid}>
                  {p.name} ({p.uid})
                </option>
              ))}
            </select>
            <span id="pilot-hint" className="muted small">
              {t('admin.pilotHint')}
            </span>
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {t('admin.error')}
          </p>
        )}
        <button type="submit" className="btn primary">
          {t('admin.create')}
        </button>
      </form>
      {made && <SecretBox made={made} title={t('admin.ready')} />}

      <h3 className="h-small">{t('admin.list')}</h3>
      {list.length === 0 ? (
        <p className="muted small">{t('admin.empty')}</p>
      ) : (
        <table className="table">
          <caption className="sr-only">{t('admin.list')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('admin.name')}</th>
              <th scope="col">{t('admin.role')}</th>
              <th scope="col">{t('admin.protection')}</th>
              <th scope="col">{t('admin.expires')}</th>
              <th scope="col">
                <span className="sr-only">{t('admin.revoke')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.id} className={i.status === 'pending' ? undefined : 'muted'}>
                <td>
                  {i.kind === 'recovery'
                    ? `${t('admin.kindRecovery')} · ${nameOf(i.targetUid)}`
                    : i.name}
                  {i.note && <span className="muted small"> · {i.note}</span>}
                </td>
                <td>{i.role ? t(`role.${i.role}`) : '—'}</td>
                <td>{i.protection === 'pin' ? t('admin.pinCode') : '—'}</td>
                <td>
                  {t(`admin.status.${i.status}`)}
                  {i.status === 'pending' && (
                    <span className="muted small">
                      {' '}
                      · {t('admin.until', { date: date(i.expiresAt) })}
                    </span>
                  )}
                  {i.status === 'used' && i.usedBy && (
                    <span className="muted small"> · {nameOf(i.usedBy)}</span>
                  )}
                </td>
                <td>
                  {i.status === 'pending' && (
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => void revoke(i.id)}
                      aria-label={t('admin.revokeNamed', { name: i.name || nameOf(i.targetUid) })}
                      title={t('admin.revoke')}
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Members({
  people,
  spaces,
  onChange,
}: {
  people: PersonSummary[];
  spaces: SpaceSummary[];
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const date = useDate();
  const me = useStore((s) => s.uid);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <h3 className="h-small">{t('admin.members')}</h3>
      <ul className="item-list">
        {people.map((p) => (
          <li key={p.uid} className="item column">
            <div className="row-between">
              <div className="item-main">
                <strong>
                  {p.name}
                  {p.uid === me && <span className="tag">{t('admin.you')}</span>}
                  {p.pilot && <span className="tag">{t('admin.pilotBadge')}</span>}
                </strong>
                <span className="muted small">
                  {t(`role.${p.role}`)}
                  {p.invitedName &&
                    p.invitedName !== p.name &&
                    ` · ${t('admin.invitedAs', { name: p.invitedName })}`}
                  {` · ${t('admin.lastSeen', { date: date(p.lastSeenAt, false) })}`}
                  {` · ${t('admin.keysCount', { count: p.passkeys })}`}
                  {` · ${t('admin.sessionsCount', { count: p.sessions })}`}
                </span>
              </div>
              {p.role !== 'owner' && (
                <button
                  type="button"
                  className="btn secondary small-btn"
                  aria-expanded={open === p.uid}
                  aria-controls={`manage-${p.uid}`}
                  aria-label={t('admin.manageNamed', { name: p.name })}
                  onClick={() => setOpen(open === p.uid ? null : p.uid)}
                >
                  {t('admin.manage')}
                </button>
              )}
            </div>
            {open === p.uid && (
              <Manage
                person={p}
                spaces={spaces}
                onChange={onChange}
                onRemoved={() => {
                  setOpen(null);
                  onChange();
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Manage({
  person,
  spaces,
  onChange,
  onRemoved,
}: {
  person: PersonSummary;
  spaces: SpaceSummary[];
  onChange: () => void;
  onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(person.name);
  const [role, setRole] = useState<AssignableRole>(
    person.role === 'owner' ? 'member' : person.role,
  );
  const [picked, setPicked] = useState<string[]>(person.spaces);
  const [revokeExisting, setRevokeExisting] = useState(false);
  const [recovery, setRecovery] = useState<CreatedLink | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const base = `/api/admin/people/${encodeURIComponent(person.uid)}`;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api('PATCH', base, { name: name.trim(), role, spaces: picked });
    setMsg(r.ok ? { text: t('admin.saved') } : { text: t('admin.error'), error: true });
    onChange();
  };
  const signOutAll = async () => {
    const r = await api<{ revoked: number }>('DELETE', `${base}/sessions`);
    setMsg(
      r.data
        ? { text: t('admin.signedOut', { count: r.data.revoked }) }
        : { text: t('admin.error'), error: true },
    );
    onChange();
  };
  const makeRecovery = async () => {
    const r = await api<CreatedLink>('POST', `${base}/recovery`, { revokeExisting });
    if (r.data) setRecovery(r.data);
    else setMsg({ text: t('admin.error'), error: true });
    onChange();
  };
  const remove = async () => {
    const r = await api('DELETE', base);
    if (r.ok) onRemoved();
    else setMsg({ text: t('admin.error'), error: true });
  };

  return (
    <div id={`manage-${person.uid}`} className="stack manage">
      <form className="stack" onSubmit={(e) => void save(e)}>
        <div className="grid-2">
          <label className="field compact">
            <span>{t('admin.rename')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LEN}
              required
            />
          </label>
          <label className="field compact">
            <span>{t('admin.role')}</span>
            <select value={role} onChange={(e) => setRole(e.target.value as AssignableRole)}>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <SpacePicker
          spaces={spaces}
          value={picked}
          onChange={setPicked}
          legend={t('admin.spaces')}
        />
        <button type="submit" className="btn primary">
          {t('admin.save')}
        </button>
      </form>
      <p className="small status-line" role="status">
        {msg && <span className={msg.error ? 'error' : undefined}>{msg.text}</span>}
      </p>
      <button
        type="button"
        className="btn secondary"
        onClick={() => void signOutAll()}
        disabled={!person.sessions}
      >
        {t('admin.signOutAll')}
      </button>
      <fieldset className="fieldset">
        <legend>{t('admin.recovery')}</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={revokeExisting}
            onChange={(e) => setRevokeExisting(e.target.checked)}
          />
          <span>{t('admin.recoveryRevoke')}</span>
        </label>
        <button type="button" className="btn secondary" onClick={() => void makeRecovery()}>
          {t('admin.recoveryCreate')}
        </button>
        {recovery && <SecretBox made={recovery} title={t('admin.recoveryReady')} />}
      </fieldset>
      {confirmRemove ? (
        <div className="confirm-row" role="group" aria-label={t('admin.remove')}>
          <span className="small">{t('admin.removeConfirm', { name: person.name })}</span>
          <button type="button" className="btn danger" onClick={() => void remove()}>
            {t('admin.remove')}
          </button>
          <button type="button" className="btn ghost" onClick={() => setConfirmRemove(false)}>
            {t('account.cancel')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn ghost danger-text"
          onClick={() => setConfirmRemove(true)}
        >
          {t('admin.remove')}
        </button>
      )}
    </div>
  );
}

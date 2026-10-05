import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Globe, Lock, Trash2, Users } from 'lucide-react';
import {
  INVITE_ROLES,
  MAX_SPACE_NAME,
  SLUG_RE,
  roleAtLeast,
  slugify,
  type InviteRole,
  type InviteSummary,
  type SpaceAccess,
  type SpaceDetail,
  type SpaceSettings,
  type SpaceSummary,
} from '@agora/shared';
import { api } from '../net/api';
import { goToSpace } from '../route';
import { store, toast, useStore } from '../state/store';
import { Dialog } from './common';

/** Current space details (role, settings), refreshed when a dialog opens. */
function useSpaceDetail(slug: string) {
  const [detail, setDetail] = useState<SpaceDetail | null>(null);
  const reload = useCallback(async () => {
    const r = await api<SpaceDetail>('GET', `/api/spaces/${slug}`);
    if (r.data) setDetail(r.data);
  }, [slug]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return [detail, setDetail, reload] as const;
}

/** Spaces list, "my name here", and the create form (P2.3). */
export function SpacesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const current = useStore((s) => s.space);
  const [list, setList] = useState<SpaceSummary[] | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [detail, setDetail] = useSpaceDetail(current);

  useEffect(() => {
    void api<{ spaces: SpaceSummary[]; canCreate: boolean }>('GET', '/api/spaces').then((r) => {
      setList(r.data?.spaces ?? []);
      setCanCreate(!!r.data?.canCreate);
    });
  }, []);

  return (
    <Dialog title={t('spaces.title')} onClose={onClose} wide>
      <div className="stack">
        <section aria-labelledby="spaces-list">
          <h3 id="spaces-list" className="h-small">
            {t('spaces.yours')}
          </h3>
          {list === null ? (
            <p className="muted small" aria-busy="true">
              {t('spaces.loading')}
            </p>
          ) : (
            <ul className="space-list">
              {list.map((s) => (
                <li key={s.id} className={s.slug === current ? 'current' : undefined}>
                  <span className="space-icon" aria-hidden>
                    {s.access === 'invite' ? <Lock size={14} /> : <Globe size={14} />}
                  </span>
                  <span className="space-main">
                    <span className="space-name">{s.name}</span>
                    <span className="muted small">
                      {t(s.access === 'invite' ? 'spaces.accessInvite' : 'spaces.accessOpen')}
                      {s.role ? ` · ${t(`role.${s.role}`)}` : ''}
                      {' · '}
                      <Users size={12} aria-hidden /> {t('spaces.online', { count: s.online })}
                    </span>
                  </span>
                  {s.slug === current ? (
                    <span className="space-here">{t('spaces.here')}</span>
                  ) : (
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => goToSpace(s.slug)}
                      aria-label={t('spaces.enterNamed', { name: s.name })}
                    >
                      {t('spaces.enter')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        {detail && (
          <section aria-labelledby="spaces-here" className="stack">
            <h3 id="spaces-here" className="h-small">
              {t('spaces.thisSpace', { name: detail.name })}
            </h3>
            <DisplayNameForm detail={detail} onSaved={setDetail} />
            {detail.canManage && (
              <button
                type="button"
                className="btn secondary"
                onClick={() => store.set({ dialog: 'spaceSettings' })}
              >
                {t('spaces.manage')}
              </button>
            )}
          </section>
        )}
        {canCreate && <CreateSpaceForm />}
      </div>
    </Dialog>
  );
}

function DisplayNameForm({
  detail,
  onSaved,
}: {
  detail: SpaceDetail;
  onSaved: (d: SpaceDetail) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(detail.displayName ?? '');
  const [msg, setMsg] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const r = await api<SpaceDetail>('PATCH', `/api/spaces/${detail.slug}/me`, {
      displayName: name.trim() || null,
    });
    if (r.data) {
      onSaved(r.data);
      setMsg(t('spaces.nameSaved'));
    } else setMsg(t('spaces.errorGeneric'));
  };
  return (
    <form className="inline-form" onSubmit={(e) => void save(e)}>
      <label className="field">
        <span>{t('spaces.myName')}</span>
        <input
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('spaces.myNamePlaceholder')}
        />
        <span className="muted small">{t('spaces.myNameHint')}</span>
      </label>
      <button type="submit" className="btn secondary">
        {t('common.save')}
      </button>
      <p className="small" role="status">
        {msg}
      </p>
    </form>
  );
}

function CreateSpaceForm() {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [access, setAccess] = useState<SpaceAccess>('invite');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const effectiveSlug = slugTouched ? slug : name.trim() ? slugify(name) : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('spaces.errorName');
    if (!SLUG_RE.test(effectiveSlug)) return setError('spaces.errorSlug');
    setBusy(true);
    const r = await api<SpaceDetail>('POST', '/api/spaces', {
      name: name.trim(),
      slug: effectiveSlug,
      access,
      template: 'hq',
    });
    setBusy(false);
    if (r.data) {
      toast('spaces.created', { name: r.data.name });
      goToSpace(r.data.slug);
    } else
      setError(
        r.error === 'slug_taken'
          ? 'spaces.errorTaken'
          : r.error === 'too_many_spaces'
            ? 'spaces.errorTooMany'
            : r.error === 'bad_request'
              ? 'spaces.errorSlug'
              : 'spaces.errorGeneric',
      );
  };

  return (
    <section aria-labelledby="spaces-create">
      <h3 id="spaces-create" className="h-small">
        {t('spaces.create')}
      </h3>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span>{t('spaces.name')}</span>
          <input
            value={name}
            maxLength={MAX_SPACE_NAME}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>{t('spaces.slug')}</span>
          <span className="slug-input">
            <span className="muted" aria-hidden>
              /s/
            </span>
            <input
              value={effectiveSlug}
              maxLength={32}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              aria-describedby="slug-hint"
              spellCheck={false}
              autoCapitalize="off"
            />
          </span>
          <span id="slug-hint" className="muted small">
            {t('spaces.slugHint')}
          </span>
        </label>
        <AccessChoice value={access} onChange={setAccess} />
        <p className="muted small">{t('spaces.templateNote')}</p>
        {error && (
          <p className="error" role="alert">
            {t(error)}
          </p>
        )}
        <button type="submit" className="btn primary" disabled={busy}>
          {t('spaces.createBtn')}
        </button>
      </form>
    </section>
  );
}

function AccessChoice({
  value,
  onChange,
  disabled,
}: {
  value: SpaceAccess;
  onChange: (a: SpaceAccess) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="fieldset stack" disabled={disabled}>
      <legend>{t('spaces.access')}</legend>
      {(['invite', 'open'] as const).map((a) => (
        <label key={a} className="check">
          <input
            type="radio"
            name="space-access"
            checked={value === a}
            onChange={() => onChange(a)}
          />
          <span>
            {t(a === 'invite' ? 'spaces.accessInvite' : 'spaces.accessOpen')}
            <span className="muted small">
              {' '}
              {t(a === 'invite' ? 'spaces.accessInviteHint' : 'spaces.accessOpenHint')}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Settings and invite links for owners and admins (P2.3, P2.4). */
export function SpaceSettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const slug = useStore((s) => s.space);
  const [detail, setDetail] = useSpaceDetail(slug);
  return (
    <Dialog title={t('spaceSettings.title')} onClose={onClose} wide>
      {!detail ? (
        <p className="muted small" aria-busy="true">
          {t('spaces.loading')}
        </p>
      ) : !detail.canManage ? (
        <p>{t('spaceSettings.notAllowed')}</p>
      ) : (
        <div className="stack">
          <SettingsForm detail={detail} onSaved={setDetail} />
          {detail.canInvite && <Invites detail={detail} />}
        </div>
      )}
    </Dialog>
  );
}

function SettingsForm({
  detail,
  onSaved,
}: {
  detail: SpaceDetail;
  onSaved: (d: SpaceDetail) => void;
}) {
  const { t } = useTranslation();
  const [s, setS] = useState<SpaceSettings>(detail.settings);
  const [msg, setMsg] = useState<{ key: string; error?: boolean } | null>(null);
  const num = (k: 'capacity' | 'connectR' | 'disconnectR' | 'videoCap', step = 1) => (
    <label className="field compact">
      <span>{t(`spaceSettings.${k}`)}</span>
      <input
        type="number"
        step={step}
        value={s[k]}
        onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })}
      />
    </label>
  );
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (s.disconnectR <= s.connectR)
      return setMsg({ key: 'spaceSettings.errorRadii', error: true });
    const r = await api<SpaceDetail>('PATCH', `/api/spaces/${detail.slug}`, {
      ...s,
      name: s.name.trim(),
    });
    if (r.data) {
      onSaved(r.data);
      setS(r.data.settings);
      setMsg({ key: 'spaceSettings.saved' });
    } else setMsg({ key: 'spaceSettings.errorInvalid', error: true });
  };
  return (
    <form className="stack" onSubmit={(e) => void save(e)} aria-labelledby="settings-h">
      <h3 id="settings-h" className="h-small">
        {t('spaceSettings.general')}
      </h3>
      <label className="field">
        <span>{t('spaces.name')}</span>
        <input
          value={s.name}
          maxLength={MAX_SPACE_NAME}
          onChange={(e) => setS({ ...s, name: e.target.value })}
          required
        />
      </label>
      <AccessChoice
        value={s.access}
        onChange={(access) => setS({ ...s, access })}
        disabled={detail.isDefault}
      />
      {detail.isDefault && <p className="muted small">{t('spaceSettings.defaultOpen')}</p>}
      <div className="grid-2">
        {num('capacity')}
        {num('videoCap')}
        {num('connectR', 0.5)}
        {num('disconnectR', 0.5)}
      </div>
      <p className="muted small">{t('spaceSettings.radiiHint')}</p>
      {msg && (
        <p className={msg.error ? 'error' : 'small'} role={msg.error ? 'alert' : 'status'}>
          {t(msg.key)}
        </p>
      )}
      <button type="submit" className="btn primary">
        {t('common.save')}
      </button>
    </form>
  );
}

const EXPIRY = [24, 24 * 7, 24 * 30, null] as const;
const USES = [null, 1, 5, 25] as const;

function Invites({ detail }: { detail: SpaceDetail }) {
  const { t, i18n } = useTranslation();
  const [list, setList] = useState<InviteSummary[]>([]);
  const [role, setRole] = useState<InviteRole>('member');
  const [expiry, setExpiry] = useState<(typeof EXPIRY)[number]>(24 * 7);
  const [uses, setUses] = useState<(typeof USES)[number]>(null);
  const [label, setLabel] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const roles = INVITE_ROLES.filter((r) => roleAtLeast(detail.role, r));

  const reload = useCallback(async () => {
    const r = await api<{ invites: InviteSummary[] }>('GET', `/api/spaces/${detail.slug}/invites`);
    setList(r.data?.invites ?? []);
  }, [detail.slug]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(false);
    const r = await api<{ path: string }>('POST', `/api/spaces/${detail.slug}/invites`, {
      role,
      expiresInHours: expiry,
      maxUses: uses,
      label: label.trim(),
    });
    if (!r.data) return setError(true);
    setLink(`${location.origin}${r.data.path}`);
    setCopied(false);
    setLabel('');
    void reload();
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      (document.getElementById('invite-link') as HTMLInputElement | null)?.select();
    }
  };
  const revoke = async (id: string) => {
    await api('DELETE', `/api/spaces/${detail.slug}/invites/${id}`);
    void reload();
  };
  const date = (ms: number) =>
    new Intl.DateTimeFormat(i18n.language === 'fr' ? 'fr-CA' : 'en-CA', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(ms);

  return (
    <section className="stack" aria-labelledby="invites-h">
      <h3 id="invites-h" className="h-small">
        {t('invites.title')}
      </h3>
      <p className="muted small">{t('invites.intro')}</p>
      <form className="stack" onSubmit={(e) => void create(e)}>
        <div className="grid-2">
          <label className="field compact">
            <span>{t('invites.role')}</span>
            <select value={role} onChange={(e) => setRole(e.target.value as InviteRole)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field compact">
            <span>{t('invites.expires')}</span>
            <select
              value={String(expiry)}
              onChange={(e) =>
                setExpiry(e.target.value === 'null' ? null : (Number(e.target.value) as 24))
              }
            >
              {EXPIRY.map((h) => (
                <option key={String(h)} value={String(h)}>
                  {h === null ? t('invites.never') : t('invites.days', { count: h / 24 })}
                </option>
              ))}
            </select>
          </label>
          <label className="field compact">
            <span>{t('invites.maxUses')}</span>
            <select
              value={String(uses)}
              onChange={(e) =>
                setUses(e.target.value === 'null' ? null : (Number(e.target.value) as 1))
              }
            >
              {USES.map((u) => (
                <option key={String(u)} value={String(u)}>
                  {u === null ? t('invites.unlimited') : t('invites.uses', { count: u })}
                </option>
              ))}
            </select>
          </label>
          <label className="field compact">
            <span>{t('invites.label')}</span>
            <input
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('invites.labelPlaceholder')}
            />
          </label>
        </div>
        <p className="muted small">{t(`role.${role}Hint`)}</p>
        {error && (
          <p className="error" role="alert">
            {t('spaces.errorGeneric')}
          </p>
        )}
        <button type="submit" className="btn primary">
          {t('invites.create')}
        </button>
      </form>
      {link && (
        <div className="invite-link" role="status">
          <label className="field">
            <span>{t('invites.linkReady')}</span>
            <span className="row">
              <input id="invite-link" readOnly value={link} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn secondary" onClick={() => void copy()}>
                {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                <span>{t(copied ? 'invites.copied' : 'invites.copy')}</span>
              </button>
            </span>
          </label>
          <p className="muted small">{t('invites.shownOnce')}</p>
        </div>
      )}
      {list.length > 0 && (
        <table className="table">
          <caption className="sr-only">{t('invites.title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('invites.label')}</th>
              <th scope="col">{t('invites.role')}</th>
              <th scope="col">{t('invites.usage')}</th>
              <th scope="col">{t('invites.expires')}</th>
              <th scope="col">
                <span className="sr-only">{t('invites.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.id} className={i.active ? undefined : 'muted'}>
                <td>{i.label || t('invites.unnamed')}</td>
                <td>{t(`role.${i.role}`)}</td>
                <td>
                  {i.maxUses === null
                    ? t('invites.usedCount', { count: i.uses })
                    : `${i.uses} / ${i.maxUses}`}
                </td>
                <td>
                  {!i.active
                    ? t('invites.inactive')
                    : i.expiresAt === null
                      ? t('invites.never')
                      : date(i.expiresAt)}
                </td>
                <td>
                  {i.active && (
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => void revoke(i.id)}
                      aria-label={t('invites.revokeNamed', {
                        name: i.label || t('invites.unnamed'),
                      })}
                      title={t('invites.revoke')}
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
    </section>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './common';
import { Privacy } from './Info';
import { PasskeyLogin } from './PasskeyLogin';

interface Options {
  mode: 'dev' | 'access-code' | 'passkey';
  needsCode: boolean;
  devUsers: string[];
  sessionDays: number;
  sharedHours: number;
  setupPending?: boolean;
}

export function Login({
  onDone,
  invite,
  heading,
}: {
  onDone: () => void;
  /** invite token: replaces the access code (P2.4) */
  invite?: string;
  heading?: string;
}) {
  const { t } = useTranslation();
  const [opts, setOpts] = useState<Options | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  /** keep this browser's identity (ADR-028); untick on a shared computer */
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    fetch('/api/auth/options')
      .then((r) => r.json())
      .then(setOpts)
      .catch(() => setError('login.errorServer'));
  }, []);

  const login = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ...body, invite, remember }),
      });
      if (r.status === 401) setError(invite ? 'join.gone' : 'login.errorCode');
      else if (!r.ok) setError('login.errorGeneric');
      else onDone();
    } catch {
      setError('login.errorServer');
    } finally {
      setBusy(false);
    }
  };

  if (opts?.mode === 'passkey')
    return (
      <PasskeyLogin
        onDone={onDone}
        sessionDays={opts.sessionDays}
        sharedHours={opts.sharedHours}
        setupPending={!!opts.setupPending}
      />
    );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('login.errorName');
    void login({ name: name.trim(), code: code || undefined });
  };

  return (
    <main className="login">
      <div className="login-card">
        <div className="login-top">
          <div className="brand">
            <span className="brand-mark" aria-hidden />
            <h1>Agora</h1>
          </div>
          <LanguageSwitcher />
        </div>
        {heading ? <h2>{heading}</h2> : <p className="lede">{t('login.tagline')}</p>}
        {opts?.mode === 'dev' && (
          <section aria-labelledby="dev-users">
            <h2 id="dev-users" className="h-small">
              {t('login.devUsers')}
            </h2>
            <div className="dev-users">
              {opts.devUsers.map((u, i) => (
                <button
                  key={u}
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => void login({ name: u, devUser: i })}
                >
                  {u}
                </button>
              ))}
            </div>
            <p className="muted small">{t('login.devNote')}</p>
          </section>
        )}
        <form onSubmit={submit} className="stack">
          <label className="field">
            <span>{t('login.name')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoComplete="name"
              required
            />
          </label>
          {opts?.needsCode && !invite && (
            <label className="field">
              <span>{t('login.code')}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                type="password"
                autoComplete="off"
                required
              />
            </label>
          )}
          {opts?.mode === 'access-code' && (
            <label className="check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>
                {t('login.remember')}
                <span className="muted small"> {t('login.rememberHint')}</span>
              </span>
            </label>
          )}
          {error && (
            <p className="error" role="alert">
              {t(error)}
            </p>
          )}
          <button type="submit" className="btn primary" disabled={busy || !opts}>
            {t('login.enter')}
          </button>
        </form>
        <p className="muted small">
          {t('login.privacyNote')}{' '}
          <button type="button" className="link" onClick={() => setShowPrivacy(true)}>
            {t('privacy.title')}
          </button>
        </p>
      </div>
      {showPrivacy && <Privacy onClose={() => setShowPrivacy(false)} />}
    </main>
  );
}

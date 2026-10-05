import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound } from 'lucide-react';
import { passkeysSupported, signInWithPasskey, type PasskeyError } from '../net/passkey';
import { LanguageSwitcher } from './common';
import { Privacy } from './Info';

/** Card frame shared by the sign-in and link pages. */
export function AuthCard({ children }: { children: ReactNode }) {
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
        {children}
      </div>
    </main>
  );
}

/**
 * Sign-in page in passkey mode (PLAN P2.14, docs/AUTH.md "Sign-in"). One button: the
 * browser shows the passkeys it has for this site, so there is no username to type and
 * the page says nothing about who has an account.
 */
export function PasskeyLogin({
  onDone,
  sessionDays,
  sharedHours,
  setupPending,
}: {
  onDone: () => void;
  sessionDays: number;
  sharedHours: number;
  /** nobody owns this server yet (first start) */
  setupPending: boolean;
}) {
  const { t } = useTranslation();
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PasskeyError | null>(null);
  const [link, setLink] = useState('');
  const [linkBad, setLinkBad] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const supported = passkeysSupported();

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const r = await signInWithPasskey(shared);
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.error);
  };

  /** Pasted link → same page, so the fragment stays in this browser. */
  const openInvite = (e: FormEvent) => {
    e.preventDefault();
    try {
      const u = new URL(link.trim(), location.origin);
      const ok =
        u.origin === location.origin &&
        ['/join', '/setup', '/recover'].includes(u.pathname) &&
        u.hash.length > 20;
      if (!ok) return setLinkBad(true);
      if (location.pathname === u.pathname) {
        history.replaceState(null, '', `${u.pathname}${u.hash}`);
        location.reload();
      } else location.assign(`${u.pathname}${u.hash}`);
    } catch {
      setLinkBad(true);
    }
  };

  return (
    <AuthCard>
      <h2>{t('auth.title')}</h2>
      {setupPending && (
        <div className="notice" role="note">
          <strong>{t('auth.setupTitle')}</strong>
          <p className="small">{t('auth.setupText')}</p>
        </div>
      )}
      <p className="lede">{t('auth.lede')}</p>
      <button
        type="button"
        className="btn primary big"
        onClick={() => void signIn()}
        disabled={busy || !supported}
        aria-describedby={error ? 'auth-error' : undefined}
      >
        <KeyRound size={18} aria-hidden />
        <span>{t(busy ? 'auth.signingIn' : 'auth.signIn')}</span>
      </button>
      <label className="check">
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
        <span>
          {t('auth.shared')}
          <span className="muted small">
            {' '}
            {t('auth.sharedHint', { hours: sharedHours, days: sessionDays })}
          </span>
        </span>
      </label>
      {(error || !supported) && (
        <p id="auth-error" className={error === 'cancelled' ? 'muted small' : 'error'} role="alert">
          {t(`auth.error.${error ?? 'unsupported'}`)}
        </p>
      )}
      <details className="auth-more">
        <summary>{t('auth.haveInvite')}</summary>
        <form className="stack" onSubmit={openInvite}>
          <label className="field">
            <span>{t('auth.inviteLink')}</span>
            <input
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setLinkBad(false);
              }}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={linkBad}
            />
          </label>
          {linkBad && (
            <p className="error" role="alert">
              {t('auth.inviteBad')}
            </p>
          )}
          <button type="submit" className="btn secondary" disabled={!link.trim()}>
            {t('auth.inviteOpen')}
          </button>
        </form>
      </details>
      <details className="auth-more">
        <summary>{t('auth.lost')}</summary>
        <p className="small">{t('auth.lostText')}</p>
      </details>
      <details className="auth-more">
        <summary>{t('auth.whatIs')}</summary>
        <p className="small">{t('auth.whatIsText')}</p>
      </details>
      <p className="muted small">
        {t('login.privacyNote')}{' '}
        <button type="button" className="link" onClick={() => setShowPrivacy(true)}>
          {t('privacy.title')}
        </button>
      </p>
      {showPrivacy && <Privacy onClose={() => setShowPrivacy(false)} />}
    </AuthCard>
  );
}

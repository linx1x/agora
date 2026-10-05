import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { InvitePreview } from '@agora/shared';
import { api } from '../net/api';
import { goToSpace } from '../route';
import { LanguageSwitcher } from './common';
import { Login } from './Login';

/**
 * `/join/:token` (P2.4): show where the link leads, sign in if needed (the link replaces
 * the access code), then join the space with the link's role and enter it.
 */
export function Join({ token }: { token: string }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<InvitePreview | null | 'error'>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<InvitePreview>('GET', `/api/invites/${encodeURIComponent(token)}`).then((r) =>
      setPreview(
        r.data ??
          (r.status === 404 ? ({ valid: false, reason: 'not_found' } as InvitePreview) : 'error'),
      ),
    );
    void fetch('/api/me', { credentials: 'same-origin' })
      .then((r) => setSignedIn(r.ok))
      .catch(() => setSignedIn(false));
  }, [token]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    const r = await api<{ slug: string }>(
      'POST',
      `/api/invites/${encodeURIComponent(token)}/accept`,
    );
    setBusy(false);
    if (r.data) goToSpace(r.data.slug);
    else setError(r.status === 410 ? 'join.gone' : 'join.errorGeneric');
  };

  if (preview === null || signedIn === null) return <div className="boot" aria-busy="true" />;
  const valid = preview !== 'error' && preview.valid;

  if (valid && !signedIn)
    return (
      <Login
        invite={token}
        heading={t('join.title', { name: preview.spaceName })}
        onDone={() => void accept()}
      />
    );

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
        {preview === 'error' ? (
          <p className="error" role="alert">
            {t('login.errorServer')}
          </p>
        ) : valid ? (
          <div className="stack">
            <h2>{t('join.title', { name: preview.spaceName })}</h2>
            <p>{t('join.as', { role: t(`role.${preview.role}`) })}</p>
            {error && (
              <p className="error" role="alert">
                {t(error)}
              </p>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void accept()}
            >
              {t('join.accept')}
            </button>
          </div>
        ) : (
          <div className="stack">
            <h2>{t('join.invalidTitle')}</h2>
            <p role="alert">{t(`join.reason.${preview.reason ?? 'not_found'}`)}</p>
            <button type="button" className="btn secondary" onClick={() => location.assign('/')}>
              {t('join.home')}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

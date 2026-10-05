import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, KeyRound, Smartphone } from 'lucide-react';
import { MAX_NAME_LEN, PIN_LENGTH, type TicketPreview } from '@agora/shared';
import { api } from '../net/api';
import { addPasskey, checkPin, claimTicket, type PasskeyError } from '../net/passkey';
import { AuthCard } from './PasskeyLogin';

type Step = 'loading' | 'invalid' | 'pin' | 'details' | 'done';

/**
 * `/join#…`, `/setup#…`, `/recover#…` (PLAN P2.13, P2.15, docs/AUTH.md "Claim flow"):
 * PIN when the link has one → name → create a passkey → offer a second device → enter.
 */
export function Claim({ token }: { token: string }) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState<Step>('loading');
  const [preview, setPreview] = useState<TicketPreview | null>(null);
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PasskeyError | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [second, setSecond] = useState<'idle' | 'added' | PasskeyError>('idle');

  useEffect(() => {
    void api<TicketPreview>('POST', '/api/tickets/preview', { token }).then((r) => {
      if (!r.data) return setStep('invalid');
      setPreview(r.data);
      setName(r.data.name);
      setStep(r.data.needsPin ? 'pin' : 'details');
    });
  }, [token]);

  const date = (ms: number) =>
    new Intl.DateTimeFormat(i18n.language === 'fr' ? 'fr-CA' : 'en-CA', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(ms);

  const submitPin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await checkPin(token, pin);
    setBusy(false);
    if (r.ok) {
      setName(r.name);
      setStep('details');
    } else if (r.error === 'invalid') setStep('invalid');
    else {
      setError(r.error);
      setLeft(r.left ?? null);
      setPin('');
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const kind = preview!.kind;
    const chosen = kind === 'recovery' ? undefined : name.trim();
    if (kind !== 'recovery' && !chosen) return;
    setBusy(true);
    setError(null);
    const r = await claimTicket(token, preview!.needsPin ? pin : undefined, chosen, shared);
    setBusy(false);
    if (r.ok) setStep('done');
    else if (r.error === 'invalid') setStep('invalid');
    else setError(r.error);
  };

  const another = async () => {
    setBusy(true);
    const r = await addPasskey();
    setBusy(false);
    setSecond(r.ok ? 'added' : r.error);
  };

  if (step === 'loading')
    return (
      <AuthCard>
        <p aria-busy="true">{t('claim.loading')}</p>
      </AuthCard>
    );

  if (step === 'invalid' || !preview)
    return (
      <AuthCard>
        <h2>{t('claim.invalidTitle')}</h2>
        <p role="alert">{t('auth.error.invalid')}</p>
        <button type="button" className="btn secondary" onClick={() => location.assign('/')}>
          {t('claim.home')}
        </button>
      </AuthCard>
    );

  const title =
    preview.kind === 'setup'
      ? 'claim.setupTitle'
      : preview.kind === 'recovery'
        ? 'claim.recoveryTitle'
        : 'claim.inviteTitle';

  if (step === 'done')
    return (
      <AuthCard>
        <h2>
          <CheckCircle2 size={22} aria-hidden className="ok-icon" /> {t('claim.doneTitle')}
        </h2>
        <p>{t('claim.doneText')}</p>
        <section className="stack" aria-labelledby="second-h">
          <h3 id="second-h" className="h-small">
            {t('claim.addAnother')}
          </h3>
          <p className="muted small">{t('claim.addAnotherHint')}</p>
          {second === 'added' ? (
            <p role="status">{t('claim.added')}</p>
          ) : (
            <button
              type="button"
              className="btn secondary"
              onClick={() => void another()}
              disabled={busy}
            >
              <Smartphone size={16} aria-hidden />
              <span>{t('claim.addAnother')}</span>
            </button>
          )}
          {second !== 'idle' && second !== 'added' && (
            <p className={second === 'cancelled' ? 'muted small' : 'error'} role="alert">
              {t(`auth.error.${second}`)}
            </p>
          )}
        </section>
        <button
          type="button"
          className="btn primary"
          onClick={() => location.assign(preview.kind === 'recovery' ? '/' : '/s/hq')}
        >
          {t('claim.enter')}
        </button>
      </AuthCard>
    );

  return (
    <AuthCard>
      <h2>{t(title)}</h2>
      {preview.kind === 'recovery' && preview.name && (
        <p>{t('claim.recoveryFor', { name: preview.name })}</p>
      )}
      <p className="muted small">{t('claim.expires', { date: date(preview.expiresAt) })}</p>

      {step === 'pin' ? (
        <form className="stack" onSubmit={(e) => void submitPin(e)}>
          <label className="field">
            <span>{t('claim.pinLabel')}</span>
            <input
              className="pin-input"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={PIN_LENGTH}
              required
              aria-invalid={!!error}
              aria-describedby="pin-hint"
              autoFocus
            />
            <span id="pin-hint" className="muted small">
              {t('claim.pinHint')}
            </span>
          </label>
          {error && (
            <p className="error" role="alert">
              {error === 'bad_pin' && left !== null
                ? t('claim.pinLeft', { count: left })
                : t(`auth.error.${error}`)}
            </p>
          )}
          <button
            type="submit"
            className="btn primary"
            disabled={busy || pin.length !== PIN_LENGTH}
          >
            {t('claim.continue')}
          </button>
        </form>
      ) : (
        <form className="stack" onSubmit={(e) => void create(e)}>
          {preview.kind !== 'recovery' && (
            <label className="field">
              <span>{t('claim.nameLabel')}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_NAME_LEN}
                autoComplete="name"
                required
                aria-describedby="name-hint"
              />
              <span id="name-hint" className="muted small">
                {t(preview.kind === 'setup' ? 'claim.ownerNameHint' : 'claim.nameHint')}
              </span>
            </label>
          )}
          <p>{t('claim.passkeyIntro')}</p>
          <label className="check">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span>{t('auth.shared')}</span>
          </label>
          {error && (
            <p className={error === 'cancelled' ? 'muted small' : 'error'} role="alert">
              {t(`auth.error.${error}`)}
            </p>
          )}
          <button type="submit" className="btn primary big" disabled={busy}>
            <KeyRound size={18} aria-hidden />
            <span>{t(busy ? 'claim.creating' : 'claim.create')}</span>
          </button>
          {preview.kind === 'invite' && <p className="muted small">{t('claim.privacy')}</p>}
        </form>
      )}
    </AuthCard>
  );
}

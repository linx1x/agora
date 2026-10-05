import {
  WebAuthnError,
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { api, type ApiResult } from './api';

/**
 * Browser side of passkeys (PLAN P2.14, P2.15, P2.17) on @simplewebauthn/browser 14.
 * Every function resolves to `{ ok }` or an error code the UI turns into a message.
 */
export type PasskeyError =
  | 'unsupported'
  | 'cancelled'
  | 'exists'
  | 'not_recognised'
  | 'invalid'
  | 'pin_required'
  | 'bad_pin'
  | 'rate_limited'
  | 'last_passkey'
  | 'failed';

export type Result<T = object> =
  ({ ok: true } & T) | { ok: false; error: PasskeyError; left?: number };

export const passkeysSupported = () => browserSupportsWebAuthn();

/** The user closed the browser prompt, or it timed out: not an error worth shouting about. */
function fromBrowser(err: unknown): PasskeyError {
  if (err instanceof WebAuthnError) {
    if (err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'exists';
    if (err.code === 'ERROR_CEREMONY_ABORTED') return 'cancelled';
  }
  if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError'))
    return 'cancelled';
  if (err instanceof Error && err.name === 'InvalidStateError') return 'exists';
  return 'failed';
}

const known = (e: string | null): PasskeyError =>
  e &&
  ['not_recognised', 'invalid', 'pin_required', 'bad_pin', 'rate_limited', 'last_passkey'].includes(
    e,
  )
    ? (e as PasskeyError)
    : 'failed';

/** "Se connecter avec une clé d'accès". */
export async function signInWithPasskey(shared: boolean): Promise<Result> {
  if (!passkeysSupported()) return { ok: false, error: 'unsupported' };
  const o = await api<{ flowId: string; options: PublicKeyCredentialRequestOptionsJSON }>(
    'POST',
    '/api/auth/passkey/options',
  );
  if (!o.data) return { ok: false, error: o.status === 429 ? 'rate_limited' : 'failed' };
  let response;
  try {
    response = await startAuthentication({ optionsJSON: o.data.options });
  } catch (err) {
    return { ok: false, error: fromBrowser(err) };
  }
  const v = await api('POST', '/api/auth/passkey/verify', {
    flowId: o.data.flowId,
    response,
    shared,
  });
  return v.ok ? { ok: true } : { ok: false, error: known(v.error) };
}

/** Check an invite PIN before asking for a passkey (gives the name to pre-fill). */
export async function checkPin(token: string, pin: string): Promise<Result<{ name: string }>> {
  const r = await api<{ name: string }>('POST', '/api/tickets/check', { token, pin });
  if (r.data) return { ok: true, name: r.data.name };
  const left = r.errorBody?.left;
  return { ok: false, error: known(r.error), left: typeof left === 'number' ? left : undefined };
}

/** Use a setup / invite / recovery link: make a passkey and sign in. */
export async function claimTicket(
  token: string,
  pin: string | undefined,
  name: string | undefined,
  shared: boolean,
): Promise<Result<{ kind: string }>> {
  if (!passkeysSupported()) return { ok: false, error: 'unsupported' };
  const o = await api<{ flowId: string; options: PublicKeyCredentialCreationOptionsJSON }>(
    'POST',
    '/api/tickets/options',
    { token, ...(pin ? { pin } : {}), ...(name ? { name } : {}) },
  );
  if (!o.data) {
    const left = o.errorBody?.left;
    return { ok: false, error: known(o.error), left: typeof left === 'number' ? left : undefined };
  }
  let response;
  try {
    response = await startRegistration({ optionsJSON: o.data.options });
  } catch (err) {
    return { ok: false, error: fromBrowser(err) };
  }
  const v = await api<{ kind: string }>('POST', '/api/tickets/verify', {
    flowId: o.data.flowId,
    response,
    shared,
    ...(name ? { name } : {}),
  });
  return v.data ? { ok: true, kind: v.data.kind } : { ok: false, error: known(v.error) };
}

/**
 * Prove it is still me with one of my passkeys (asked before adding or removing one when
 * the sign-in is more than a few minutes old).
 */
export async function reauthenticate(): Promise<Result> {
  const o = await api<{ flowId: string; options: PublicKeyCredentialRequestOptionsJSON }>(
    'POST',
    '/api/auth/passkey/options',
  );
  if (!o.data) return { ok: false, error: o.status === 429 ? 'rate_limited' : 'failed' };
  let response;
  try {
    response = await startAuthentication({ optionsJSON: o.data.options });
  } catch (err) {
    return { ok: false, error: fromBrowser(err) };
  }
  const v = await api('POST', '/api/auth/passkey/reauth', { flowId: o.data.flowId, response });
  return v.ok ? { ok: true } : { ok: false, error: known(v.error) };
}

/** Run an API call; when the server wants a fresh passkey check first, do it and retry. */
export async function withStepUp<T>(
  call: () => Promise<ApiResult<T>>,
): Promise<ApiResult<T> | { ok: false; error: PasskeyError }> {
  const r = await call();
  if (r.error !== 'reauth_required') return r;
  const re = await reauthenticate();
  if (!re.ok) return re;
  return call();
}

/** Account page: add a passkey (another device, a security key, a phone via QR). */
export async function addPasskey(): Promise<Result> {
  if (!passkeysSupported()) return { ok: false, error: 'unsupported' };
  const o = await withStepUp(() =>
    api<{ flowId: string; options: PublicKeyCredentialCreationOptionsJSON }>(
      'POST',
      '/api/me/passkeys/options',
    ),
  );
  if (!('data' in o) || !o.data) return { ok: false, error: known(o.error) };
  let response;
  try {
    response = await startRegistration({ optionsJSON: o.data.options });
  } catch (err) {
    return { ok: false, error: fromBrowser(err) };
  }
  const v = await api('POST', '/api/me/passkeys/verify', { flowId: o.data.flowId, response });
  return v.ok
    ? { ok: true }
    : { ok: false, error: v.error === 'already_registered' ? 'exists' : known(v.error) };
}

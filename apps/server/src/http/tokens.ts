import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionClaims {
  uid: string;
  name: string;
  /**
   * token purpose: short-lived realtime token, or the long-lived device identity cookie
   * that keeps the same uid across access-code logins (ADR-028). Sessions themselves are
   * server-side rows since P2.12 (http/sessions.ts).
   */
  typ: 'rt' | 'id';
  exp: number;
  /** build mode unlocked with BUILDER_CODE for this session */
  b?: boolean;
  /** platform admin unlocked with ADMIN_CODE for this session */
  a?: boolean;
  /** realtime tokens: the session they were minted from (P2.12) */
  sid?: string;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function sign(claims: SessionClaims, secret: string): string {
  const body = b64(JSON.stringify(claims));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verify(
  token: string | undefined,
  secret: string,
  typ: SessionClaims['typ'],
): SessionClaims | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expect = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionClaims;
    if (c.typ !== typ || typeof c.exp !== 'number' || c.exp < Date.now()) return null;
    return c;
  } catch {
    return null;
  }
}

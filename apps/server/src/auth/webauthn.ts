import { randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { hostMatches, type Config } from '../config';
import type { StoredPasskey } from '../db/store';

/**
 * Passkey ceremonies (PLAN P2.14, docs/AUTH.md "Sign-in"), on @simplewebauthn/server 14.
 *
 * - Discoverable credentials only (`residentKey: required`): sign-in needs no username,
 *   so the page reveals nothing about who has an account.
 * - User verification is required (Face ID, Windows Hello, device PIN…), not just presence.
 * - No attestation: we trust any authenticator; the invite is what proves who someone is.
 * - Every challenge is single-use, kept server-side for 5 minutes and bound to its purpose.
 */

const FLOW_MS = 5 * 60_000;
const MAX_FLOWS = 5_000;
const TIMEOUT_MS = 120_000;

interface Flow {
  kind: 'reg' | 'auth';
  challenge: string;
  rpID: string;
  origins: string[];
  exp: number;
  /** registration: whose credential and what it is for */
  data?: unknown;
}

export const toB64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
export const fromB64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

export interface NewCredential {
  id: string;
  publicKey: string;
  counter: number;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
}

export class Ceremonies {
  private flows = new Map<string, Flow>();

  constructor(
    private cfg: Config,
    private now: () => number = Date.now,
  ) {}

  /**
   * Relying party for this request. Production: always PASSKEY_RP_ID / PUBLIC_ORIGIN.
   * Development also accepts the request's own host (localhost, a LAN name) so a laptop
   * with PUBLIC_ORIGIN set in .env still works.
   */
  rp(req: FastifyRequest): { rpID: string; origins: string[] } {
    const here = `${req.protocol}://${req.host}`;
    const configured = this.cfg.passkeyRpId;
    if (configured && (hostMatches(req.hostname, configured) || this.cfg.env === 'production'))
      return {
        rpID: configured,
        origins: this.cfg.publicOrigins.length ? this.cfg.publicOrigins : [here],
      };
    return { rpID: req.hostname, origins: [...this.cfg.publicOrigins, here] };
  }

  private put(f: Flow): string {
    const now = this.now();
    if (this.flows.size >= MAX_FLOWS)
      for (const [id, x] of this.flows) if (x.exp <= now) this.flows.delete(id);
    if (this.flows.size >= MAX_FLOWS) this.flows.delete(this.flows.keys().next().value!);
    const id = randomBytes(16).toString('base64url');
    this.flows.set(id, f);
    return id;
  }

  /** Take (and forget) a flow: each challenge can be answered once. */
  private take(id: unknown, kind: Flow['kind']): Flow | null {
    if (typeof id !== 'string') return null;
    const f = this.flows.get(id);
    this.flows.delete(id);
    if (!f || f.kind !== kind || f.exp <= this.now()) return null;
    return f;
  }

  async startRegistration<T>(
    req: FastifyRequest,
    user: { uid: string; name: string },
    existing: StoredPasskey[],
    data: T,
  ): Promise<{ flowId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    const { rpID, origins } = this.rp(req);
    const options = await generateRegistrationOptions({
      rpName: 'Agora',
      rpID,
      userName: user.name,
      userDisplayName: user.name,
      userID: new TextEncoder().encode(user.uid),
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: TIMEOUT_MS,
    });
    const flowId = this.put({
      kind: 'reg',
      challenge: options.challenge,
      rpID,
      origins,
      exp: this.now() + FLOW_MS,
      data,
    });
    return { flowId, options };
  }

  /** The new credential and the flow's data, or null when anything does not check out. */
  async finishRegistration<T>(
    flowId: unknown,
    response: unknown,
  ): Promise<{ data: T; credential: NewCredential } | null> {
    const f = this.take(flowId, 'reg');
    if (!f || !response || typeof response !== 'object') return null;
    try {
      const v = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: f.challenge,
        expectedOrigin: f.origins,
        expectedRPID: f.rpID,
        requireUserVerification: true,
      });
      if (!v.verified) return null;
      const info = v.registrationInfo;
      return {
        data: f.data as T,
        credential: {
          id: info.credential.id,
          publicKey: toB64u(info.credential.publicKey),
          counter: info.credential.counter,
          transports: (info.credential.transports ?? []).slice(0, 8),
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
        },
      };
    } catch {
      return null;
    }
  }

  async startAuthentication(
    req: FastifyRequest,
  ): Promise<{ flowId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
    const { rpID, origins } = this.rp(req);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      timeout: TIMEOUT_MS,
    });
    const flowId = this.put({
      kind: 'auth',
      challenge: options.challenge,
      rpID,
      origins,
      exp: this.now() + FLOW_MS,
    });
    return { flowId, options };
  }

  /**
   * Verify a sign-in. `lookup` finds the stored credential by id. Returns the passkey with
   * its new counter and backup state, or null.
   */
  async finishAuthentication(
    flowId: unknown,
    response: unknown,
    lookup: (id: string) => Promise<StoredPasskey | null>,
  ): Promise<{ passkey: StoredPasskey; counter: number; backedUp: boolean } | null> {
    const f = this.take(flowId, 'auth');
    if (!f || !response || typeof response !== 'object') return null;
    const r = response as AuthenticationResponseJSON;
    if (typeof r.id !== 'string' || r.id.length > 1400) return null;
    const passkey = await lookup(r.id);
    if (!passkey) return null;
    // The authenticator says whose credential it is; it must be the stored owner.
    const handle = r.response?.userHandle;
    if (handle && Buffer.from(handle, 'base64url').toString() !== passkey.uid) return null;
    try {
      const v = await verifyAuthenticationResponse({
        response: r,
        expectedChallenge: f.challenge,
        expectedOrigin: f.origins,
        expectedRPID: f.rpID,
        credential: {
          id: passkey.id,
          publicKey: fromB64u(passkey.publicKey),
          counter: passkey.counter,
          transports: passkey.transports,
        },
        requireUserVerification: true,
      });
      if (!v.verified) return null;
      return {
        passkey,
        counter: v.authenticationInfo.newCounter,
        backedUp: v.authenticationInfo.credentialBackedUp,
      };
    } catch {
      return null;
    }
  }
}

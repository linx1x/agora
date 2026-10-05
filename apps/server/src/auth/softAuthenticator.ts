import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

/**
 * A software passkey for tests only (never imported by the server): ES256, "none"
 * attestation, user presence + verification flags set, like a platform authenticator
 * after Face ID. Lets the server tests run real WebAuthn ceremonies without a browser.
 */
export class SoftAuthenticator {
  private creds = new Map<
    string,
    { key: KeyObject; rpId: string; userHandle: string; counter: number }
  >();

  constructor(
    /** page origin the "browser" reports, e.g. http://localhost:80 */
    public origin = 'http://localhost:80',
    /** false = the authenticator does not verify the user (UV flag off) */
    public verifies = true,
  ) {}

  private flags(attested: boolean) {
    return (attested ? 0x40 : 0) | (this.verifies ? 0x04 : 0) | 0x01;
  }

  private clientData(type: string, challenge: string) {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }),
    );
  }

  /** navigator.credentials.create() → RegistrationResponseJSON */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  create(options: any) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const id = randomBytes(16);
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))],
        [-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))],
      ]),
    );
    const rpId: string = options.rp.id;
    const len = Buffer.alloc(2);
    len.writeUInt16BE(id.length);
    const authData = Buffer.concat([
      createHash('sha256').update(rpId).digest(),
      Buffer.from([this.flags(true)]),
      Buffer.alloc(4),
      Buffer.alloc(16),
      len,
      id,
      Buffer.from(cose),
    ]);
    const att = new Map<string, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', new Uint8Array(authData)],
    ]);
    const attestationObject = isoCBOR.encode(att as Parameters<typeof isoCBOR.encode>[0]);
    const credId = id.toString('base64url');
    this.creds.set(credId, { key: privateKey, rpId, userHandle: options.user.id, counter: 0 });
    return {
      id: credId,
      rawId: credId,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: this.clientData('webauthn.create', options.challenge).toString('base64url'),
        attestationObject: Buffer.from(attestationObject).toString('base64url'),
        transports: ['internal'],
      },
    };
  }

  /** navigator.credentials.get() → AuthenticationResponseJSON (first matching credential) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(options: any, credId?: string) {
    const entry = [...this.creds].find(
      ([id, c]) => c.rpId === options.rpId && (!credId || id === credId),
    );
    if (!entry) throw new Error('no credential for this site');
    const [id, c] = entry;
    c.counter++;
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(c.counter);
    const authData = Buffer.concat([
      createHash('sha256').update(c.rpId).digest(),
      Buffer.from([this.flags(false)]),
      counter,
    ]);
    const clientDataJSON = this.clientData('webauthn.get', options.challenge);
    const signature = sign(
      'sha256',
      Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()]),
      c.key,
    );
    return {
      id,
      rawId: id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataJSON.toString('base64url'),
        authenticatorData: authData.toString('base64url'),
        signature: signature.toString('base64url'),
        userHandle: c.userHandle,
      },
    };
  }

  get ids() {
    return [...this.creds.keys()];
  }
}

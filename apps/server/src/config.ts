import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { CONNECT_R, DISCONNECT_R, VIDEO_CAP, parseFlags, type Flags } from '@agora/shared';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

/** `KEY=` in .env or `${KEY:-}` in compose gives "": treat it as unset. */
const unsetIfEmpty = (v: unknown) => (v === '' ? undefined : v);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  /**
   * dev = pick a test user (refused in production); access-code = name + shared code (pilot);
   * passkey = invite-only accounts (ADR-032, docs/AUTH.md); entra = P2.1, not built
   */
  AUTH_MODE: z.enum(['dev', 'access-code', 'passkey', 'entra']).optional(),
  AUTH_DEV_LOGIN: bool,
  ACCESS_CODE: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  /** "Shared computer" sessions: hours, fixed (ADR-032) */
  SESSION_HOURS: z.coerce.number().positive().default(12),
  /** Normal sessions: days, sliding — renewed while used (ADR-032) */
  SESSION_DAYS: z.coerce.number().positive().max(365).default(30),
  /**
   * Where browsers load Agora from, e.g. https://agora.example.com (comma-separated for
   * several). State-changing requests from any other origin are refused. Default: the
   * request's own host.
   */
  PUBLIC_ORIGIN: z.preprocess(unsetIfEmpty, z.string().optional()),
  /**
   * Passkey domain (WebAuthn RP ID). Default: the host of PUBLIC_ORIGIN. Changing it later
   * invalidates every passkey (people then need a recovery link).
   */
  PASSKEY_RP_ID: z.preprocess(unsetIfEmpty, z.string().optional()),
  /** Also write the owner setup link to this file (mode 600), e.g. for container hosts. */
  SETUP_LINK_FILE: z.preprocess(unsetIfEmpty, z.string().optional()),
  COOKIE_SECURE: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  ICE_SERVERS: z.string().optional(),
  /** livekit | p2p. Default: livekit when LIVEKIT_URL is set, else p2p (ADR-031). */
  MEDIA_BACKEND: z.preprocess(unsetIfEmpty, z.enum(['livekit', 'p2p']).optional()),
  /** wss:// URL browsers use to reach LiveKit (ws://localhost:7880 for `livekit-server --dev`) */
  LIVEKIT_URL: z.string().optional(),
  /** URL this server uses for the LiveKit API, when it differs (default: LIVEKIT_URL as http(s)) */
  LIVEKIT_API_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  /** Room name prefix, so several Agora servers can share one LiveKit */
  LIVEKIT_ROOM_PREFIX: z.preprocess(
    unsetIfEmpty,
    z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .default('agora'),
  ),
  FEATURE_FLAGS: z.string().optional(),
  CONNECT_R: z.coerce.number().default(CONNECT_R),
  DISCONNECT_R: z.coerce.number().default(DISCONNECT_R),
  VIDEO_CAP: z.coerce.number().int().default(VIDEO_CAP),
  SPACE_CAPACITY: z.coerce.number().int().default(50),
  STATIC_DIR: z.string().optional(),
  MAP_PATH: z.string().optional(),
  /** Without Postgres, builder edits are kept in this JSON file (dev default: data/maps.json). */
  MAP_SAVE_PATH: z.string().optional(),
  /** Comma-separated user ids allowed to use build mode (e.g. dev-alice, later Entra object ids). */
  BUILDER_IDS: z.string().optional(),
  /** Shared code that unlocks build mode for the current session (Settings → Build mode). */
  BUILDER_CODE: z.string().optional(),
  /** Platform admins: admin in every space (settings, invites). Entra group later (P6.1). */
  ADMIN_IDS: z.string().optional(),
  /** Shared code that makes the current session a platform admin (Settings). */
  ADMIN_CODE: z.string().optional(),
  /** Who may create spaces (P2.3). */
  SPACE_CREATION: z.enum(['everyone', 'admins']).default('everyone'),
  /** Name of the default space on first boot. */
  HQ_NAME: z.string().trim().min(1).max(60).default('Agora'),
  /** Days the "remember this device" identity cookie lasts (access-code mode, ADR-028). */
  IDENTITY_DAYS: z.coerce.number().int().min(0).max(730).default(365),
  CHAT_RETENTION_DAYS: z.coerce.number().int().default(365),
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),
});

const IceSchema = z.array(
  z.object({
    urls: z.union([z.string(), z.array(z.string())]),
    username: z.string().optional(),
    credential: z.string().optional(),
  }),
);

export interface Config {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  logLevel: string;
  authMode: 'dev' | 'access-code' | 'passkey';
  accessCode?: string;
  sessionSecret: string;
  sessionHours: number;
  sessionDays: number;
  /** allowed browser origins for state-changing requests (empty = same host only) */
  publicOrigins: string[];
  /** WebAuthn relying party id; undefined = the request's host (development only) */
  passkeyRpId?: string;
  setupLinkFile?: string;
  cookieSecure: boolean;
  databaseUrl?: string;
  iceServers: z.infer<typeof IceSchema>;
  mediaBackend: 'livekit' | 'p2p';
  livekit?: {
    url: string;
    apiUrl: string;
    apiKey: string;
    apiSecret: string;
    prefix: string;
  };
  flags: Flags;
  connectR: number;
  disconnectR: number;
  videoCap: number;
  capacity: number;
  staticDir?: string;
  mapPath?: string;
  mapSavePath?: string;
  builderIds: string[];
  builderCode?: string;
  adminIds: string[];
  adminCode?: string;
  spaceCreation: 'everyone' | 'admins';
  hqName: string;
  identityDays: number;
  chatRetentionDays: number;
  warnings: string[];
}

export class ConfigError extends Error {}

/** WebAuthn: the RP ID must equal the origin's host or be a registrable parent of it. */
export const hostMatches = (host: string, rpId: string) =>
  host === rpId || host.endsWith(`.${rpId}`);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env);
  const warnings: string[] = [];
  const authMode = e.AUTH_MODE ?? (e.AUTH_DEV_LOGIN ? 'dev' : 'access-code');
  if (authMode === 'dev' && e.NODE_ENV === 'production')
    throw new ConfigError('AUTH_MODE=dev (AUTH_DEV_LOGIN) is refused when NODE_ENV=production.');
  if (authMode === 'entra')
    throw new ConfigError(
      'AUTH_MODE=entra is not implemented in this version yet (PLAN P2.1). Use access-code.',
    );
  let sessionSecret = e.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    if (e.NODE_ENV === 'production' && sessionSecret)
      throw new ConfigError('SESSION_SECRET must be at least 32 characters.');
    sessionSecret = randomBytes(32).toString('hex');
    warnings.push(
      'SESSION_SECRET not set: generated a random one; invite PINs and remembered devices reset on restart.',
    );
  }
  let publicOrigins: string[] = [];
  if (e.PUBLIC_ORIGIN) {
    try {
      publicOrigins = e.PUBLIC_ORIGIN.split(',')
        .map((o) => o.trim())
        .filter(Boolean)
        .map((o) => new URL(o).origin);
    } catch {
      throw new ConfigError('PUBLIC_ORIGIN must be a URL like https://agora.example.com.');
    }
  }
  const envRoles = e.BUILDER_IDS || e.BUILDER_CODE || e.ADMIN_IDS || e.ADMIN_CODE;
  if (authMode === 'passkey' && envRoles) {
    if (e.NODE_ENV === 'production')
      throw new ConfigError(
        'AUTH_MODE=passkey: remove BUILDER_IDS, BUILDER_CODE, ADMIN_IDS and ADMIN_CODE (roles live in the database).',
      );
    warnings.push(
      'AUTH_MODE=passkey ignores BUILDER_IDS, BUILDER_CODE, ADMIN_IDS and ADMIN_CODE: roles live in the database.',
    );
  }
  let passkeyRpId = e.PASSKEY_RP_ID;
  if (!passkeyRpId && publicOrigins[0]) passkeyRpId = new URL(publicOrigins[0]).hostname;
  if (authMode === 'passkey' && e.NODE_ENV === 'production') {
    if (!publicOrigins.length)
      throw new ConfigError(
        'AUTH_MODE=passkey needs PUBLIC_ORIGIN in production (e.g. https://agora.example.com).',
      );
    if (!e.SESSION_SECRET || e.SESSION_SECRET.length < 32)
      throw new ConfigError('AUTH_MODE=passkey needs a SESSION_SECRET of 32+ characters.');
  }
  if (passkeyRpId && publicOrigins.some((o) => !hostMatches(new URL(o).hostname, passkeyRpId!)))
    throw new ConfigError('PASSKEY_RP_ID must be the PUBLIC_ORIGIN host or a parent domain of it.');
  if (authMode === 'access-code' && !e.ACCESS_CODE)
    warnings.push('ACCESS_CODE not set: anyone who can reach this URL can enter with a name.');
  let iceServers: Config['iceServers'] = [];
  if (e.ICE_SERVERS) {
    try {
      iceServers = IceSchema.parse(JSON.parse(e.ICE_SERVERS));
    } catch {
      throw new ConfigError('ICE_SERVERS must be a JSON array of RTCIceServer objects.');
    }
  } else if (!e.LIVEKIT_URL && e.MEDIA_BACKEND !== 'livekit')
    warnings.push(
      'ICE_SERVERS not set: video/audio only connects people on networks that can reach each other directly.',
    );
  const mediaBackend = e.MEDIA_BACKEND ?? (e.LIVEKIT_URL ? 'livekit' : 'p2p');
  let livekit: Config['livekit'];
  if (mediaBackend === 'livekit') {
    if (!e.LIVEKIT_URL || !/^wss?:\/\//.test(e.LIVEKIT_URL))
      throw new ConfigError('MEDIA_BACKEND=livekit needs LIVEKIT_URL (ws:// or wss://).');
    if (!e.LIVEKIT_API_KEY || !e.LIVEKIT_API_SECRET)
      throw new ConfigError('MEDIA_BACKEND=livekit needs LIVEKIT_API_KEY and LIVEKIT_API_SECRET.');
    if (e.NODE_ENV === 'production' && e.LIVEKIT_API_SECRET.length < 32)
      throw new ConfigError('LIVEKIT_API_SECRET must be at least 32 characters in production.');
    if (e.NODE_ENV === 'production' && e.LIVEKIT_URL.startsWith('ws://'))
      warnings.push('LIVEKIT_URL uses ws://: browsers on an https page need wss://.');
    livekit = {
      url: e.LIVEKIT_URL,
      apiUrl: e.LIVEKIT_API_URL || e.LIVEKIT_URL.replace(/^ws(s?):\/\//, 'http$1://'),
      apiKey: e.LIVEKIT_API_KEY,
      apiSecret: e.LIVEKIT_API_SECRET,
      prefix: e.LIVEKIT_ROOM_PREFIX,
    };
  }
  if (e.BUILDER_CODE && e.BUILDER_CODE.length < 8)
    throw new ConfigError('BUILDER_CODE must be at least 8 characters.');
  if (e.ADMIN_CODE && e.ADMIN_CODE.length < 12)
    throw new ConfigError('ADMIN_CODE must be at least 12 characters.');
  if (e.ADMIN_CODE && e.ADMIN_CODE === e.BUILDER_CODE)
    throw new ConfigError('ADMIN_CODE must differ from BUILDER_CODE.');
  if (e.DISCONNECT_R <= e.CONNECT_R)
    throw new ConfigError('DISCONNECT_R must be greater than CONNECT_R.');
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    authMode,
    accessCode: e.ACCESS_CODE || undefined,
    sessionSecret,
    sessionHours: e.SESSION_HOURS,
    sessionDays: e.SESSION_DAYS,
    publicOrigins,
    passkeyRpId,
    setupLinkFile: e.SETUP_LINK_FILE,
    cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : e.NODE_ENV === 'production',
    databaseUrl: e.DATABASE_URL || undefined,
    iceServers,
    mediaBackend,
    livekit,
    flags: parseFlags(e.FEATURE_FLAGS),
    connectR: e.CONNECT_R,
    disconnectR: e.DISCONNECT_R,
    videoCap: e.VIDEO_CAP,
    capacity: e.SPACE_CAPACITY,
    staticDir: e.STATIC_DIR,
    mapPath: e.MAP_PATH,
    mapSavePath: e.MAP_SAVE_PATH || (e.NODE_ENV === 'development' ? 'data/maps.json' : undefined),
    builderIds: (e.BUILDER_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    builderCode: e.BUILDER_CODE || undefined,
    adminIds: (e.ADMIN_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    adminCode: e.ADMIN_CODE || undefined,
    spaceCreation: e.SPACE_CREATION,
    hqName: e.HQ_NAME,
    identityDays: e.IDENTITY_DAYS,
    chatRetentionDays: e.CHAT_RETENTION_DAYS,
    warnings,
  };
}

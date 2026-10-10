import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  CONNECT_R,
  DEFAULT_SPACE,
  DISCONNECT_R,
  VIDEO_CAP,
  parseFlags,
  type Flags,
} from '@agora/shared';
import { PRICES, parsePrice, type LlmConfig } from './npc-brain/llm';

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
  /** NPCs (ADR-042, flag `npcs`): comma-separated space ids or addresses that have characters. */
  NPC_SPACES: z.string().optional(),
  /** Folder of character files (<id>.json); dev default data/npcs, written with the defaults. */
  NPC_DIR: z.string().optional(),
  /** Dev only: the characters' clock starts at this time (HH:MM) instead of the real time. */
  NPC_CLOCK: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Dev only: game minutes per real minute (60 = a workday in about 9 minutes). */
  NPC_TIME_SCALE: z.coerce.number().positive().max(600).default(1),
  /**
   * P15.3, ADR-044: where body decisions go. `clef` asks apps/ml at NPC_DECIDE_URL (when set);
   * `off` means the characters' own scoring only. Body decisions never go to the cloud model.
   */
  NPC_DECIDE_PROVIDER: z.enum(['clef', 'llm', 'off']).default('clef'),
  /** apps/ml, e.g. http://127.0.0.1:8790 (empty: scoring only) */
  NPC_DECIDE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** A Clef answer counts only at or above this probability; else the safe default. */
  NPC_DECIDE_MIN_P: z.coerce.number().min(0).max(1).default(0.7),
  NPC_DECIDE_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(1500),
  /** Shared secret for apps/ml when it listens beyond localhost (ML_TOKEN there). */
  NPC_DECIDE_TOKEN: z.string().optional(),
  /** Local decision log folder (no names, no Talk text); dev default data/npc-log, off otherwise. */
  NPC_LOG_DIR: z.string().optional(),
  NPC_LOG_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /**
   * P15.4 (ADR-042, ADR-045): the cloud model that writes what no prepared line covers, behind one
   * interface. `openai` = any OpenAI-compatible endpoint (DeepSeek, Mistral, OpenRouter, Ollama,
   * vLLM, llama.cpp); `anthropic` = the Messages API; `fake` = canned answers for tests (refused
   * in production). Without NPC_LLM_API_KEY nothing leaves the machine and prepared lines answer.
   */
  NPC_LLM_PROVIDER: z.preprocess(
    unsetIfEmpty,
    z.enum(['openai', 'anthropic', 'fake']).default('openai'),
  ),
  NPC_LLM_BASE_URL: z.preprocess(unsetIfEmpty, z.string().optional()),
  NPC_LLM_MODEL: z.preprocess(unsetIfEmpty, z.string().optional()),
  NPC_LLM_API_KEY: z.preprocess(unsetIfEmpty, z.string().optional()),
  /** off: ask DeepSeek-style providers not to think (the default on deepseek.com) */
  NPC_LLM_THINKING: z.preprocess(unsetIfEmpty, z.enum(['on', 'off']).optional()),
  NPC_LLM_TIMEOUT_MS: z.preprocess(
    unsetIfEmpty,
    z.coerce.number().int().min(500).max(60_000).default(8000),
  ),
  /** JSON merged into every request body */
  NPC_LLM_EXTRA_BODY: z.preprocess(unsetIfEmpty, z.string().optional()),
  /** "hit,miss,output" in US$ per 1M tokens, for a model with no built-in price */
  NPC_LLM_PRICE: z.preprocess(unsetIfEmpty, z.string().optional()),
  /** the provider's name and country (ISO code), shown in the AI notice and on the Privacy page */
  NPC_LLM_LABEL: z.preprocess(unsetIfEmpty, z.string().max(60).optional()),
  NPC_LLM_COUNTRY: z.preprocess(unsetIfEmpty, z.string().length(2).optional()),
  /** calls to the cloud model per character per hour, then prepared lines only */
  NPC_CALLS_PER_HOUR: z.preprocess(
    unsetIfEmpty,
    z.coerce.number().int().min(1).max(100_000).default(60),
  ),
  /** daily spend ceiling (US$), then prepared lines only */
  NPC_LLM_DAILY_USD: z.preprocess(unsetIfEmpty, z.coerce.number().min(0).max(10_000).default(1)),
  /** P15.6: the voice service on the operator's machine (apps/ml `--voice`); empty = no voices */
  NPC_VOICE_URL: z.preprocess(unsetIfEmpty, z.string().url().optional()),
  NPC_VOICE_TOKEN: z.preprocess(unsetIfEmpty, z.string().optional()),
  NPC_VOICE_TIMEOUT_MS: z.preprocess(
    unsetIfEmpty,
    z.coerce.number().int().min(500).max(120_000).default(20_000),
  ),
  /**
   * P15.8 (ADR-049): web lookups through your own SearXNG (JSON output enabled). Off by default; it
   * sends the words of a question, without names, to the search engines SearXNG uses, so turning it
   * on changes the AI notice and asks everyone again. Needs the cloud model (it writes the answer).
   */
  NPC_WEB: z.preprocess(unsetIfEmpty, z.enum(['off', 'searxng']).default('off')),
  NPC_WEB_URL: z.preprocess(unsetIfEmpty, z.string().url().optional()),
  /** comma-separated sites whose results may be quoted (and their subdomains); empty = any */
  NPC_WEB_SITES: z.preprocess(unsetIfEmpty, z.string().optional()),
  NPC_WEB_TIMEOUT_MS: z.preprocess(
    unsetIfEmpty,
    z.coerce.number().int().min(500).max(30_000).default(4000),
  ),
  /** searches per hour for the whole server */
  NPC_WEB_PER_HOUR: z.preprocess(
    unsetIfEmpty,
    z.coerce.number().int().min(1).max(10_000).default(30),
  ),
  /** P15.5: notes a character keeps about a person are deleted after this many days without a refresh */
  NPC_MEMORY_DAYS: z.preprocess(unsetIfEmpty, z.coerce.number().int().min(1).max(3650).default(90)),
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
  /** ADR-042: which spaces have characters, where their files are, and their clock */
  npc: {
    spaces: string[];
    dir?: string;
    clock?: string;
    timeScale: number;
    /** P15.3: Clef for body decisions (absent: scoring only) */
    decide?: { url: string; minP: number; timeoutMs: number; token?: string };
    minP: number;
    /** P15.3: the local decision log */
    log?: { dir: string; days: number };
    /** P15.4: the cloud model for words (absent: prepared lines only, nothing leaves the machine) */
    llm?: NpcLlmSettings;
    callsPerHour: number;
    dailyUsd: number;
    /** P15.5: how long notes about a person live without being refreshed */
    memoryDays: number;
    /** P15.6: the voice service, if any */
    voice?: { url: string; token?: string; timeoutMs: number };
    /** P15.8: web lookups, if any */
    web?: { url: string; sites: string[]; timeoutMs: number; perHour: number };
  };
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

/** The cloud model behind `complete()`, with how the AI notice names it (P15.4). */
export interface NpcLlmSettings {
  /** answers canned JSON, for tests; never in production */
  fake: boolean;
  cfg: LlmConfig;
  label: string;
  /** ISO 3166-1 alpha-2 code, or '' when unknown */
  country: string;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/** What the AI notice says about a provider we know by its address. */
const KNOWN_HOSTS: { re: RegExp; label: string; country: string }[] = [
  { re: /(^|\.)deepseek\.com$/, label: 'DeepSeek', country: 'CN' },
  { re: /(^|\.)anthropic\.com$/, label: 'Anthropic', country: 'US' },
  { re: /(^|\.)openai\.com$/, label: 'OpenAI', country: 'US' },
  { re: /(^|\.)mistral\.ai$/, label: 'Mistral', country: 'FR' },
  { re: /^(localhost|127\.0\.0\.1|\[::1\])$/, label: 'local', country: 'CA' },
];

function npcLlm(e: z.infer<typeof EnvSchema>): NpcLlmSettings | undefined {
  if (e.NPC_LLM_PROVIDER === 'fake') {
    if (e.NODE_ENV === 'production')
      throw new ConfigError('NPC_LLM_PROVIDER=fake is refused when NODE_ENV=production.');
    return {
      fake: true,
      cfg: {
        provider: 'openai',
        baseUrl: 'fake',
        model: 'fake',
        apiKey: '',
        timeoutMs: e.NPC_LLM_TIMEOUT_MS,
      },
      label: e.NPC_LLM_LABEL ?? 'Test',
      country: e.NPC_LLM_COUNTRY?.toUpperCase() ?? 'CA',
    };
  }
  if (!e.NPC_LLM_API_KEY) return undefined;
  const provider = e.NPC_LLM_PROVIDER;
  const model = e.NPC_LLM_MODEL ?? 'deepseek-flash';
  const baseUrl =
    e.NPC_LLM_BASE_URL ??
    (provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.deepseek.com');
  const host = hostOf(baseUrl);
  const known = KNOWN_HOSTS.find((k) => k.re.test(host));
  // DeepSeek thinks by default (seconds and output tokens a character line does not need)
  const thinking = e.NPC_LLM_THINKING ?? (known?.label === 'DeepSeek' ? 'off' : undefined);
  let extraBody: Record<string, unknown> | undefined;
  if (e.NPC_LLM_EXTRA_BODY) {
    try {
      extraBody = JSON.parse(e.NPC_LLM_EXTRA_BODY) as Record<string, unknown>;
    } catch {
      throw new ConfigError('NPC_LLM_EXTRA_BODY must be a JSON object.');
    }
  }
  return {
    fake: false,
    cfg: {
      provider: provider === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl,
      model,
      apiKey: e.NPC_LLM_API_KEY,
      timeoutMs: e.NPC_LLM_TIMEOUT_MS,
      thinking,
      extraBody,
      price: parsePrice(e.NPC_LLM_PRICE) ?? PRICES[model],
    },
    label: e.NPC_LLM_LABEL ?? known?.label ?? host,
    country: e.NPC_LLM_COUNTRY?.toUpperCase() ?? known?.country ?? '',
  };
}

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
    npc: {
      spaces: (e.NPC_SPACES || DEFAULT_SPACE)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      dir: e.NPC_DIR || (e.NODE_ENV === 'development' ? 'data/npcs' : undefined),
      // dev clocks never apply in production
      clock: e.NODE_ENV === 'production' ? undefined : e.NPC_CLOCK,
      timeScale: e.NODE_ENV === 'production' ? 1 : e.NPC_TIME_SCALE,
      decide:
        e.NPC_DECIDE_PROVIDER === 'clef' && e.NPC_DECIDE_URL
          ? {
              url: e.NPC_DECIDE_URL,
              minP: e.NPC_DECIDE_MIN_P,
              timeoutMs: e.NPC_DECIDE_TIMEOUT_MS,
              token: e.NPC_DECIDE_TOKEN || undefined,
            }
          : undefined,
      minP: e.NPC_DECIDE_MIN_P,
      log: (() => {
        const dir = e.NPC_LOG_DIR || (e.NODE_ENV === 'development' ? 'data/npc-log' : undefined);
        return dir && dir !== 'off' ? { dir, days: e.NPC_LOG_DAYS } : undefined;
      })(),
      llm: npcLlm(e),
      callsPerHour: e.NPC_CALLS_PER_HOUR,
      dailyUsd: e.NPC_LLM_DAILY_USD,
      memoryDays: e.NPC_MEMORY_DAYS,
      voice: e.NPC_VOICE_URL
        ? { url: e.NPC_VOICE_URL, token: e.NPC_VOICE_TOKEN, timeoutMs: e.NPC_VOICE_TIMEOUT_MS }
        : undefined,
      web:
        e.NPC_WEB === 'searxng' && e.NPC_WEB_URL
          ? {
              url: e.NPC_WEB_URL,
              sites: (e.NPC_WEB_SITES ?? '')
                .split(',')
                .map((x) => x.trim().toLowerCase())
                .filter(Boolean),
              timeoutMs: e.NPC_WEB_TIMEOUT_MS,
              perHour: e.NPC_WEB_PER_HOUR,
            }
          : undefined,
    },
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

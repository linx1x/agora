import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

describe('config', () => {
  it('refuses dev auth bypass in production (CLAUDE.md hard rule)', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_DEV_LOGIN: 'true' })).toThrow(
      ConfigError,
    );
    expect(() => loadConfig({ NODE_ENV: 'production', AUTH_MODE: 'dev' })).toThrow(ConfigError);
  });
  it('allows dev auth in development', () => {
    expect(loadConfig({ NODE_ENV: 'development', AUTH_DEV_LOGIN: 'true' }).authMode).toBe('dev');
  });
  it('defaults to access-code and parses ICE servers', () => {
    const c = loadConfig({
      NODE_ENV: 'production',
      ICE_SERVERS: '[{"urls":"turn:turn.example:3478","username":"u","credential":"p"}]',
    });
    expect(c.authMode).toBe('access-code');
    expect(c.iceServers[0]?.username).toBe('u');
  });
  it('validates admin and builder codes and space creation policy', () => {
    expect(() => loadConfig({ ADMIN_CODE: 'short' })).toThrow(ConfigError);
    expect(() =>
      loadConfig({ ADMIN_CODE: 'same-code-1234', BUILDER_CODE: 'same-code-1234' }),
    ).toThrow(ConfigError);
    const c = loadConfig({ ADMIN_IDS: 'a, b', SPACE_CREATION: 'admins' });
    expect(c.adminIds).toEqual(['a', 'b']);
    expect(c.spaceCreation).toBe('admins');
    expect(() => loadConfig({ SPACE_CREATION: 'nobody' })).toThrow();
  });
  it('rejects malformed ICE servers and short secrets in production', () => {
    expect(() => loadConfig({ ICE_SERVERS: 'nope' })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short' })).toThrow(
      ConfigError,
    );
  });
  it('picks LiveKit when LIVEKIT_URL is set and checks its settings (ADR-031)', () => {
    expect(loadConfig({}).mediaBackend).toBe('p2p');
    // empty values from .env or compose mean "not set"
    expect(
      loadConfig({ MEDIA_BACKEND: '', LIVEKIT_URL: '', LIVEKIT_ROOM_PREFIX: '' }).mediaBackend,
    ).toBe('p2p');
    const c = loadConfig({
      LIVEKIT_URL: 'wss://rtc.example.org',
      LIVEKIT_API_KEY: 'k',
      LIVEKIT_API_SECRET: 's',
    });
    expect(c.mediaBackend).toBe('livekit');
    expect(c.livekit).toMatchObject({ apiUrl: 'https://rtc.example.org', prefix: 'agora' });
    expect(
      loadConfig({
        MEDIA_BACKEND: 'p2p',
        LIVEKIT_URL: 'ws://localhost:7880',
        LIVEKIT_API_KEY: 'k',
        LIVEKIT_API_SECRET: 's',
      }).mediaBackend,
    ).toBe('p2p');
    expect(() => loadConfig({ MEDIA_BACKEND: 'livekit' })).toThrow(ConfigError);
    expect(() =>
      loadConfig({ LIVEKIT_URL: 'https://x', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' }),
    ).toThrow(ConfigError);
    expect(() => loadConfig({ LIVEKIT_URL: 'ws://localhost:7880' })).toThrow(ConfigError);
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        LIVEKIT_URL: 'wss://rtc.example.org',
        LIVEKIT_API_KEY: 'k',
        LIVEKIT_API_SECRET: 'short',
      }),
    ).toThrow(ConfigError);
  });
});

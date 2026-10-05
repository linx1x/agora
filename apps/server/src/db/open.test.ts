import { describe, expect, it } from 'vitest';
import { describeDbUrl, openStore, StoreUnavailableError } from './store';

const DEAD = 'postgres://postgres:secret@127.0.0.1:1/agora';
const log = { warn: () => {} };

describe('openStore', () => {
  it('falls back to memory when allowed', async () => {
    const s = await openStore(DEAD, log);
    expect(s.kind).toBe('memory');
    await s.close();
  });
  it('refuses to fall back in strict mode (invite-only accounts)', async () => {
    await expect(openStore(DEAD, log, undefined, { strict: true })).rejects.toBeInstanceOf(
      StoreUnavailableError,
    );
  });
  it('never puts credentials in messages', async () => {
    expect(describeDbUrl(DEAD)).toBe('127.0.0.1:1/agora');
    const err = await openStore(DEAD, log, undefined, { strict: true }).catch((e: Error) => e);
    expect(String(err)).not.toContain('secret');
  });
});

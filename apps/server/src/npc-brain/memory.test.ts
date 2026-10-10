import { describe, expect, it } from 'vitest';
import { MEMORY_MAX } from '@agora/shared';
import { MemoryStore } from '../db/store';
import { DEFAULT_NPCS } from '../world/npc-personas';
import { Brain, fakeDecider } from './decide';
import { fakeCompleter } from './llm';
import { MemoryKeeper } from './memory';
import { NpcLineBanks } from './lines';
import { TalkBudget, TalkEngine, type TalkInput } from './talk';

const silent = { info: () => {}, warn: () => {} };
const ZOE = DEFAULT_NPCS[0]!;
const flush = () => new Promise<void>((r) => setImmediate(r));

function setup(
  opts: {
    remember?: { top: string; p: number } | 'down';
    llm?: ReturnType<typeof fakeCompleter> | null;
    now?: () => number;
  } = {},
) {
  const store = new MemoryStore();
  const clef = fakeDecider((id) =>
    id === 'remember'
      ? ((opts.remember ?? { top: 'yes', p: 0.95 }) as never)
      : id === 'kind'
        ? { top: 'other', p: 0.95 }
        : id === 'pii'
          ? { top: 'no', p: 0.95 }
          : id === 'lang'
            ? { top: 'fr', p: 0.95 }
            : undefined,
  );
  const brain = new Brain(clef, 0.7, silent, { backoffMs: 1 });
  const llm =
    opts.llm === null
      ? undefined
      : (opts.llm ??
        fakeCompleter((req) =>
          req.system.startsWith('You write')
            ? JSON.stringify({
                summary: 'Travaille sur la migration des courriels. Préfère le français.',
              })
            : JSON.stringify({ say: 'Intéressant!' }),
        ));
  const budget = new TalkBudget(60, 1);
  const keeper = new MemoryKeeper({
    store,
    brain,
    llm,
    budget,
    log: silent,
    days: 90,
    timeoutMs: 1000,
    now: opts.now,
  });
  const engine = new TalkEngine({
    brain,
    llm,
    banks: new NpcLineBanks(undefined, silent),
    budget,
    cfg: { minP: 0.7, llmTimeoutMs: 1000 },
    rng: () => 0.3,
    log: silent,
    onEnd: (c) => void keeper.consider(c),
  });
  return { store, clef, llm, keeper, engine };
}

const input = (body: string, uid = 'u1'): TalkInput => ({
  persona: ZOE,
  cast: DEFAULT_NPCS.map((p) => ({ id: p.id, name: p.name })),
  speaker: { key: uid, name: 'Vincent Sylvestre' },
  body,
  place: 'Oasis',
  time: '10:30',
  mapNames: [],
});

async function chat(e: TalkEngine, lines: string[], uid = 'u1') {
  for (const l of lines) await e.handle(input(l, uid));
}

const noteRequests = (llm: ReturnType<typeof fakeCompleter> | undefined) =>
  (llm?.calls ?? []).filter((c) => c.system.startsWith('You write'));

describe('what a character remembers about a person (P15.5, ADR-046)', () => {
  it('keeps notes after a worthwhile conversation, written by the model, nothing before it ends', async () => {
    const { engine, store, llm } = setup();
    await chat(engine, [
      'Je travaille sur la migration des courriels',
      'Je préfère parler en français',
    ]);
    expect(await store.getNpcMemory('u1', 'zoe')).toBeNull(); // the conversation is still open
    engine.end('u1');
    await flush();
    await flush();
    expect(await store.getNpcMemory('u1', 'zoe')).toContain('migration');
    expect(noteRequests(llm)).toHaveLength(1);
  });

  it('writes the notes from the part of the conversation without personal information only', async () => {
    const { engine, llm } = setup();
    await chat(engine, [
      'Ma carte est 4111 1111 1111 1111 et je suis Vincent Sylvestre',
      'Je travaille sur la migration des courriels',
      'Je préfère le français',
    ]);
    engine.end('u1');
    await flush();
    await flush();
    const asked = JSON.stringify(noteRequests(llm));
    expect(asked).not.toMatch(/4111|Sylvestre/);
    expect(asked).toContain('migration');
    expect(asked).toContain('Vincent'); // first name only
  });

  it('keeps nothing when the conversation is too short, Clef is unsure or says no, or Clef is down (negative controls)', async () => {
    for (const [name, o, lines] of [
      ['short', {}, ['Je travaille sur la migration']],
      ['no', { remember: { top: 'no', p: 0.95 } }, ['un', 'deux']],
      ['unsure', { remember: { top: 'yes', p: 0.55 } }, ['un', 'deux']],
      ['down', { remember: 'down' as const }, ['un', 'deux']],
    ] as const) {
      const { engine, store, llm } = setup(o);
      await chat(engine, [...lines]);
      engine.end('u1');
      await flush();
      await flush();
      expect(await store.getNpcMemory('u1', 'zoe'), name).toBeNull();
      expect(noteRequests(llm), name).toHaveLength(0);
    }
    // control: the same two messages with a confident "yes" are kept
    const { engine, store } = setup();
    await chat(engine, ['un', 'deux']);
    engine.end('u1');
    await flush();
    await flush();
    expect(await store.getNpcMemory('u1', 'zoe')).not.toBeNull();
  });

  it('keeps nothing without a cloud model: Clef cannot write notes', async () => {
    const { engine, store } = setup({ llm: null });
    await chat(engine, ['un', 'deux']);
    engine.end('u1');
    await flush();
    await flush();
    expect(await store.getNpcMemory('u1', 'zoe')).toBeNull();
  });

  it('drops notes that carry personal information, a link or too much, and cuts long ones', async () => {
    for (const bad of [
      'Écrire à jean@test.example',
      'Voir https://exemple.ca',
      'Appeler au 418 555 0199',
    ]) {
      const { engine, store } = setup({
        llm: fakeCompleter(() => JSON.stringify({ summary: bad })),
      });
      await chat(engine, ['un', 'deux']);
      engine.end('u1');
      await flush();
      await flush();
      expect(await store.getNpcMemory('u1', 'zoe'), bad).toBeNull();
    }
    const { engine, store } = setup({
      llm: fakeCompleter(() => JSON.stringify({ summary: 'mot '.repeat(400) })),
    });
    await chat(engine, ['un', 'deux']);
    engine.end('u1');
    await flush();
    await flush();
    const kept = (await store.getNpcMemory('u1', 'zoe'))!;
    expect(kept.length).toBeLessThanOrEqual(MEMORY_MAX);
  });

  it('is told to the character on the next talk, and only for the same person', async () => {
    const { engine, store, llm } = setup();
    await store.setNpcMemory('u1', 'zoe', 'Aime le thé.');
    const sys = (calls: typeof llm) => (calls?.calls ?? []).map((c) => c.system).join('\n');
    await engine.handle({ ...input('Quelle est la capitale du Pérou?'), memory: 'Aime le thé.' });
    expect(sys(llm)).toContain('What you remember about Vincent: Aime le thé.');
    const other = setup();
    await other.engine.handle(input('Quelle est la capitale du Pérou?', 'u2'));
    expect(sys(other.llm)).toContain('You have no memory of Vincent yet.');
  });

  it('"Forget me" deletes every note of that person only, and a conversation forgotten is not noted', async () => {
    const { engine, store, keeper, llm } = setup();
    await store.setNpcMemory('u1', 'zoe', 'a');
    await store.setNpcMemory('u1', 'felix', 'b');
    await store.setNpcMemory('u2', 'zoe', 'c');
    await chat(engine, ['un', 'deux']);
    engine.end('u1', { keep: false }); // forgotten: nothing may be written from this chat
    await keeper.forget('u1');
    await flush();
    await flush();
    expect(noteRequests(llm)).toHaveLength(0);
    expect(await store.getNpcMemory('u1', 'zoe')).toBeNull();
    expect(await store.getNpcMemory('u1', 'felix')).toBeNull();
    expect(await store.getNpcMemory('u2', 'zoe')).toBe('c');
  });

  it('notes still being written when the person asks to be forgotten are dropped', async () => {
    let release!: () => void;
    const slow = fakeCompleter(
      (req) =>
        new Promise<string>((r) => {
          if (req.system.startsWith('You write'))
            release = () => r(JSON.stringify({ summary: 'Aime le café.' }));
          else r(JSON.stringify({ say: 'ok' }));
        }) as never,
    );
    const { engine, store, keeper } = setup({ llm: slow });
    await chat(engine, ['un', 'deux']);
    engine.end('u1');
    await flush();
    await flush();
    await keeper.forget('u1');
    release();
    await flush();
    await flush();
    expect(await store.getNpcMemory('u1', 'zoe')).toBeNull();
  });

  it('notes not refreshed for the retention period are deleted, fresh ones stay', async () => {
    let t = Date.UTC(2026, 0, 1);
    const { keeper, store } = setup({ now: () => t });
    await store.setNpcMemory('old', 'zoe', 'x');
    await new Promise((r) => setTimeout(r, 5));
    t = Date.now() + 91 * 86_400_000;
    await store.setNpcMemory('new', 'zoe', 'y'); // written "now" by the store clock
    // the in-memory store stamps with the real clock; move the keeper's clock past the old one only
    t = Date.now() + 89 * 86_400_000;
    expect(await keeper.prune()).toBe(0);
    t = Date.now() + 91 * 86_400_000;
    expect(await keeper.prune()).toBe(2);
    expect(await store.getNpcMemory('old', 'zoe')).toBeNull();
  });
});

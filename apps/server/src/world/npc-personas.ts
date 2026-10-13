import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { wardrobe, NpcPersonaSchema, type NpcPersona } from '@agora/shared';

/**
 * The first cast (ADR-042; names are drafts). Each one is also written to `data/npcs/<id>.json`
 * in development the first time, so Vincent edits files, not code; the server picks up changes
 * within a few seconds.
 */
export const DEFAULT_NPCS: NpcPersona[] = [
  {
    id: 'zoe',
    name: 'Zoé',
    avatar: wardrobe({ skin: 1, hair: 1, hairColor: 5, top: 7, bottom: 3, accessory: 0 }),
    home: 'oasis',
    enabled: true,
    locale: 'fr-CA',
    role: 'Animatrice de communauté, toujours la première arrivée',
    personality:
      "Enthousiaste et chaleureuse, célèbre tout, beaucoup de points d'exclamation, la première à accueillir les nouveaux.",
    traits: { extrovert: 0.95, nightOwl: 0.1, focus: 0.4 },
    schedule: [
      { at: '08:30', do: 'arrive' },
      { at: '08:35', do: 'coffee' },
      { from: '08:45', to: '10:30', do: 'desk' },
      { from: '10:30', to: '11:30', do: 'tour' },
      { at: '11:30', do: 'coffee' },
      { from: '12:00', to: '13:00', do: 'lounge' },
      { from: '13:00', to: '15:00', do: 'desk' },
      { from: '15:00', to: '16:00', do: 'tour' },
      { from: '16:00', to: '17:00', do: 'desk' },
      { at: '17:00', do: 'leave' },
    ],
    goals: [
      { text: 'Accueillir chaque personne à sa première visite', pushes: ['greet'], weight: 0.3 },
      "Faire essayer l'arcade à tout le monde",
    ],
    schedulePull: 1,
    needRates: { caffeine: 1.2 },
    knows: "Agora est le bureau virtuel. L'Atrium mène aux quatre ailes par les téléporteurs.",
    friends: { theo: 0.8, felix: 0.6 },
    fallbackLines: ['Oups, une seconde, je reviens!', "J'ai perdu le fil, tu peux répéter?"],
  },
  {
    id: 'felix',
    name: 'Félix',
    avatar: wardrobe({ skin: 5, hair: 4, hairColor: 6, top: 1, bottom: 5, accessory: 1 }),
    home: 'zen',
    enabled: true,
    locale: 'fr-CA',
    role: "Bibliothécaire de l'aile Zen",
    personality: 'Posé, parle doucement, réponses courtes, bonne écoute, jamais pressé.',
    traits: { extrovert: 0.3, nightOwl: 0.3, focus: 0.9, tea: 0.9 },
    schedule: [
      { at: '08:50', do: 'arrive' },
      { from: '09:00', to: '11:45', do: 'desk' },
      { from: '11:45', to: '12:00', do: 'tea' },
      { from: '12:00', to: '12:45', do: 'water' },
      { from: '12:45', to: '16:30', do: 'desk' },
      { from: '16:30', to: '17:00', do: 'tea' },
      { at: '17:15', do: 'leave' },
    ],
    goals: [
      { text: 'Connaître chaque salle et aider les gens perdus', pushes: ['tour'], weight: 0.2 },
      { text: 'Garder le lounge paisible', pushes: ['lounge'], weight: 0.15 },
    ],
    schedulePull: 1.2,
    needRates: {},
    knows: "Agora est le bureau virtuel. La bibliothèque de l'Atrium est une zone calme.",
    friends: { zoe: 0.6, theo: 0.5 },
    fallbackLines: ['Un instant.', 'Je reviens vers toi.'],
  },
  {
    id: 'theo',
    name: 'Théo',
    avatar: wardrobe({ skin: 3, hair: 3, hairColor: 1, top: 4, bottom: 0, accessory: 3 }),
    home: 'jungle',
    enabled: true,
    locale: 'fr-CA',
    role: 'Développeur, fan de jeux PICO-8',
    personality:
      'Curieux, blagueur, un peu distrait. Tutoie tout le monde. Aime les jeux de mots en français.',
    traits: { extrovert: 0.7, nightOwl: 0.8, focus: 0.4 },
    schedule: [
      { at: '09:40', do: 'arrive' },
      { at: '09:50', do: 'coffee' },
      { from: '10:00', to: '12:00', do: 'desk' },
      { from: '12:00', to: '13:00', do: 'lounge' },
      { from: '13:00', to: '17:30', do: 'desk' },
      { at: '17:45', do: 'leave' },
    ],
    goals: [
      {
        text: "Apprendre le prénom de chaque personne de l'aile Jungle",
        pushes: ['greet'],
        weight: 0.25,
      },
      { text: 'Battre Zoé au prochain jeu', pushes: ['friend'], weight: 0.15 },
    ],
    schedulePull: 0.9,
    needRates: { social: 1.1 },
    knows:
      "Agora est le bureau virtuel. L'aile Jungle est au nord-ouest, avec une chute et un étang.",
    friends: { zoe: 0.8, felix: 0.5 },
    fallbackLines: ["Pardon, j'ai la tête ailleurs…", 'Attends, je reviens à toi dans une minute.'],
  },
];

interface Logger {
  warn: (o: object, m?: string) => void;
  info: (o: object, m?: string) => void;
}

/** How often the folder is looked at again for edits (ms). */
const CHECK_MS = 5000;

/**
 * The cast, read from `<dir>/<id>.json` over the defaults: a file replaces the default with the
 * same id, a new file adds a character, `"enabled": false` hides one. A file that does not pass
 * the schema is logged and ignored (the default stays). Re-read when a file changes.
 */
export class NpcPersonas {
  private cached: NpcPersona[] = DEFAULT_NPCS;
  private stamp = '';
  private checkedAt = -Infinity;

  constructor(
    private dir: string | undefined,
    private log: Logger,
    opts: { writeDefaults?: boolean } = {},
  ) {
    if (dir && opts.writeDefaults && !existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
        for (const p of DEFAULT_NPCS)
          writeFileSync(join(dir, `${p.id}.json`), JSON.stringify(p, null, 2) + '\n');
        log.info({ dir }, 'wrote the default NPC files; edit them to change the characters');
      } catch (err) {
        log.warn({ dir, err: String(err) }, 'could not write the default NPC files');
      }
    }
  }

  /** The enabled characters. Cheap: the folder is checked at most every few seconds. */
  list(now = Date.now()): NpcPersona[] {
    if (!this.dir || now - this.checkedAt < CHECK_MS) return this.cached;
    this.checkedAt = now;
    let files: string[];
    try {
      files = readdirSync(this.dir).filter((f) => /^[a-z0-9-]{1,32}\.json$/.test(f));
    } catch {
      return this.cached;
    }
    const stamp = files
      .map((f) => {
        try {
          return `${f}:${statSync(join(this.dir!, f)).mtimeMs}`;
        } catch {
          return f;
        }
      })
      .join('|');
    if (stamp === this.stamp) return this.cached;
    this.stamp = stamp;
    const byId = new Map(DEFAULT_NPCS.map((p) => [p.id, p]));
    for (const f of files) {
      try {
        const r = NpcPersonaSchema.safeParse(JSON.parse(readFileSync(join(this.dir, f), 'utf8')));
        if (!r.success) {
          const i = r.error.issues[0];
          this.log.warn(
            { file: f, at: i?.path.join('.'), problem: i?.message },
            'NPC file ignored',
          );
          continue;
        }
        if (r.data.id !== f.replace(/\.json$/, '')) {
          this.log.warn({ file: f, id: r.data.id }, 'NPC file ignored: id differs from file name');
          continue;
        }
        byId.set(r.data.id, r.data);
      } catch (err) {
        this.log.warn({ file: f, err: String(err) }, 'NPC file ignored: not valid JSON');
      }
    }
    this.cached = [...byId.values()].filter((p) => p.enabled);
    return this.cached;
  }
}

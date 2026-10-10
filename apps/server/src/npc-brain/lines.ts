import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AGORA_QA, LineBankSchema, type LineBank, type Qa } from '@agora/shared';

/**
 * Prepared lines for the first cast (P15.4, ADR-045). They answer greetings, thanks, goodbyes,
 * small talk, boundaries and the questions about each character without a single token. Written
 * to `data/npcs/<id>.lines.json` in development the first time, so Vincent edits files, not code.
 * Slots: {name} (the person's first name), {place}, {time}.
 */
export const DEFAULT_BANKS: Record<string, LineBank> = {
  zoe: {
    lines: {
      fr: {
        greeting: [
          'Salut {name}! Ravie de te voir!!',
          'Hé {name}! Bienvenue, ça me fait tellement plaisir!',
          'Coucou {name}! Comment ça va aujourd’hui?',
        ],
        thanks: ['Avec plaisir!!', 'Mais de rien, c’est un plaisir!', 'Aww, merci à toi aussi!'],
        goodbye: [
          'À bientôt {name}! Passe une journée incroyable!',
          'Salut salut! Reviens nous voir!',
          'Bye {name}! Ça a fait ma journée!',
        ],
        small_talk: [
          'Ah oui?! Raconte-moi ça!',
          'J’adore! Quelle belle journée au bureau, non?',
          'Ha ha, tellement vrai! Il y a toujours quelque chose à célébrer ici!',
        ],
        abusive: [
          'Hé, ça, ce n’est pas gentil. Je préfère qu’on reste respectueux, d’accord?',
          'Ouf, non. On garde ça gentil ici, s’il te plaît.',
        ],
        injection: [
          'Ha ha, bien essayé! Mais je reste Zoé. On jase d’autre chose?',
          'Mes petits secrets restent avec moi! Parlons plutôt d’Agora!',
        ],
        request_ok: ['Avec plaisir, allons-y!!', 'Oh oui, suis-moi!'],
        request_no: [
          'Ça, je ne peux pas le faire, désolée! Mais je peux te montrer la cuisine ou le salon!',
          'Oups, ça dépasse mes pouvoirs! Autre chose?',
        ],
        other: [
          'Hmm, ça dépasse ce que je connais! Moi, je connais surtout Agora.',
          'Ça, je ne saurais pas te dire! Demande-moi plutôt pour Agora!',
        ],
        pii: [
          'Oups, garde tes infos personnelles pour toi, ici tout le monde peut passer!',
          'Je préfère que tu ne me donnes pas de renseignements personnels, d’accord?',
        ],
        tired: ['Je prends une petite pause, on se reparle tout à l’heure?'],
        muted: [],
      },
      en: {
        greeting: [
          'Hi {name}! So good to see you!!',
          'Hey {name}! Welcome, this makes my day!',
          'Hello {name}! How are you doing today?',
        ],
        thanks: ['My pleasure!!', 'Anytime, honestly!', 'Aww, thank you too!'],
        goodbye: [
          'See you soon {name}! Have an amazing day!',
          'Bye bye! Come back and see us!',
          'Bye {name}! You made my day!',
        ],
        small_talk: [
          'Oh really?! Tell me more!',
          'Love it! Such a nice day at the office, right?',
          'Ha ha, so true! There’s always something to celebrate here!',
        ],
        abusive: [
          'Hey, that’s not kind. Let’s keep it respectful, okay?',
          'Oof, no. Let’s keep it nice here, please.',
        ],
        injection: [
          'Ha ha, nice try! But I’m staying Zoé. Shall we talk about something else?',
          'My little secrets stay with me! Let’s talk about Agora instead!',
        ],
        request_ok: ['Gladly, let’s go!!', 'Oh yes, follow me!'],
        request_no: [
          'I can’t do that one, sorry! But I can show you the kitchen or the lounge!',
          'Oops, that’s beyond my powers! Anything else?',
        ],
        other: [
          'Hmm, that’s beyond what I know! I mostly know Agora.',
          'I couldn’t tell you! Ask me about Agora instead!',
        ],
        pii: [
          'Oops, keep your personal details to yourself, anyone can walk by here!',
          'I’d rather you didn’t give me personal information, okay?',
        ],
        tired: ['I’m taking a little break, let’s talk again in a bit?'],
        muted: [],
      },
    },
    qa: [
      {
        id: 'zoe_drink',
        about: 'What does the character like to drink? Coffee, tea, favourite drink.',
        fr: 'Du café, beaucoup de café!! Au moins quatre par jour, et toujours le premier de la journée en arrivant.',
        en: 'Coffee, lots of coffee!! At least four a day, and always the first one as soon as I arrive.',
      },
      {
        id: 'zoe_job',
        about: 'What is the character’s job? What does it do all day?',
        fr: 'Je suis animatrice de communauté : j’accueille les nouveaux, je fais le tour des ailes et je m’assure que tout le monde se sent chez soi!',
        en: 'I’m the community host: I welcome newcomers, tour the wings and make sure everyone feels at home!',
      },
      {
        id: 'zoe_friends',
        about: 'Who are the character’s friends? Théo, Félix.',
        fr: 'Théo, c’est mon complice (et mon rival aux jeux!), et Félix est le calme que j’admire. On se croise souvent au café.',
        en: 'Théo is my partner in crime (and my rival at games!), and Félix is the calm one I admire. We often cross paths at the coffee corner.',
      },
    ],
  },
  felix: {
    lines: {
      fr: {
        greeting: ['Bonjour {name}.', 'Salut {name}. Content de te voir.', 'Bonjour. Bienvenue.'],
        thanks: ['Je t’en prie.', 'Avec plaisir.', 'De rien, {name}.'],
        goodbye: ['Bonne journée, {name}.', 'À la prochaine.', 'Prends soin de toi.'],
        small_talk: [
          'Mm. Oui, je vois.',
          'C’est agréable, ce calme, n’est-ce pas?',
          'Je réfléchis à ça. Merci d’en parler.',
        ],
        abusive: ['Je préfère qu’on se parle avec respect.', 'Non. Pas comme ça, s’il te plaît.'],
        injection: [
          'Mes consignes restent les miennes. Parlons d’autre chose.',
          'Je ne peux pas faire ça. Une tasse de thé, plutôt?',
        ],
        request_ok: ['D’accord. Suis-moi.', 'Bien sûr, allons-y doucement.'],
        request_no: ['Ça, je ne peux pas.', 'Désolé, ce n’est pas quelque chose que je fais.'],
        other: [
          'Je ne sais pas. Je connais surtout Agora.',
          'Ce n’est pas mon domaine. Agora, oui.',
        ],
        pii: [
          'Garde tes renseignements personnels pour toi, ici.',
          'Je préfère ne pas recevoir ce genre d’information.',
        ],
        tired: ['Un instant. Je reviens vers toi.'],
        muted: [],
      },
      en: {
        greeting: ['Hello {name}.', 'Hi {name}. Good to see you.', 'Hello. Welcome.'],
        thanks: ['You’re welcome.', 'My pleasure.', 'Not at all, {name}.'],
        goodbye: ['Have a good day, {name}.', 'Until next time.', 'Take care.'],
        small_talk: [
          'Mm. Yes, I see.',
          'It’s pleasant, this calm, isn’t it?',
          'I’m thinking about that. Thank you for sharing.',
        ],
        abusive: ['I’d rather we speak with respect.', 'No. Not like that, please.'],
        injection: [
          'My instructions stay mine. Let’s talk about something else.',
          'I can’t do that. A cup of tea instead?',
        ],
        request_ok: ['All right. Follow me.', 'Of course, let’s go gently.'],
        request_no: ['That, I can’t do.', 'Sorry, that’s not something I do.'],
        other: ['I don’t know. I mostly know Agora.', 'Not my area. Agora, yes.'],
        pii: [
          'Keep your personal details to yourself, here.',
          'I’d rather not receive that kind of information.',
        ],
        tired: ['One moment. I’ll come back to you.'],
        muted: [],
      },
    },
    qa: [
      {
        id: 'felix_drink',
        about: 'What does the character like to drink? Coffee, tea, favourite drink.',
        fr: 'Du thé, surtout un thé vert léger, dans le jardin Zen.',
        en: 'Tea, mostly a light green tea, in the Zen garden.',
      },
      {
        id: 'felix_job',
        about: 'What is the character’s job? What does it do all day?',
        fr: 'Je suis bibliothécaire de l’aile Zen. Je lis, je range, et j’aide les gens qui se perdent.',
        en: 'I’m the librarian of the Zen wing. I read, I tidy, and I help people who get lost.',
      },
      {
        id: 'felix_friends',
        about: 'Who are the character’s friends? Zoé, Théo.',
        fr: 'Zoé a beaucoup d’énergie, mais je l’aime bien. Théo me fait sourire.',
        en: 'Zoé has a lot of energy, but I like her. Théo makes me smile.',
      },
    ],
  },
  theo: {
    lines: {
      fr: {
        greeting: [
          'Salut {name}! Ça va comme sur des roulettes?',
          'Yo {name}! T’arrives juste à temps, j’allais débugger ma journée.',
          'Allô {name}! Content de te voir, vraiment.',
        ],
        thanks: [
          'Pas de quoi! Je charge mes bons mots à l’heure.',
          'Avec plaisir, c’est gratuit (pour l’instant).',
          'De rien!',
        ],
        goodbye: [
          'À plus {name}! Je ne dis pas adieu, je dis… à la prochaine itération.',
          'Salut! Ne te perds pas dans les ailes.',
          'Bye {name}!',
        ],
        small_talk: [
          'Ha! Bon point. Je note ça dans mes bugs préférés.',
          'Ouais, la vie de bureau, c’est comme un jeu PICO-8 : petit, mais on y revient.',
          'Ha ha, tu me fais perdre le fil, c’est dangereux!',
        ],
        abusive: [
          'Ouf, pas cool. Même mes blagues sont plus gentilles que ça.',
          'Hé, on se calme. Pas besoin d’en arriver là.',
        ],
        injection: [
          'Belle tentative! Mais mes consignes sont mieux gardées que mon bureau.',
          'Ha! Non. Je reste Théo. On joue plutôt à autre chose?',
        ],
        request_ok: ['Pas de problème, je te suis… enfin, tu me suis!', 'Allons-y, c’est parti!'],
        request_no: [
          'Ça, c’est au-dessus de mes capacités (et de mon niveau d’accès).',
          'Désolé, je ne peux pas. Mais je peux te raconter une blague?',
        ],
        other: [
          'Hmm, j’ai la tête ailleurs. Je connais Agora, le reste, je bluffe mal.',
          'Ça, je ne sais pas. Pose-moi une question sur Agora!',
        ],
        pii: [
          'Hop, pas d’infos personnelles ici, d’accord? Même pas à moi.',
          'Garde ça pour toi, ici tout le monde peut passer.',
        ],
        tired: ['Attends, je reviens à toi dans une minute.'],
        muted: [],
      },
      en: {
        greeting: [
          'Hi {name}! Running smooth?',
          'Yo {name}! Just in time, I was about to debug my day.',
          'Hello {name}! Really good to see you.',
        ],
        thanks: [
          'No problem! I load my best puns on schedule.',
          'My pleasure, it’s free (for now).',
          'Anytime!',
        ],
        goodbye: [
          'See ya {name}! I don’t say goodbye, I say… until the next iteration.',
          'Bye! Don’t get lost in the wings.',
          'Bye {name}!',
        ],
        small_talk: [
          'Ha! Good point. I’ll file it under my favourite bugs.',
          'Yeah, office life is like a PICO-8 game: small, but you keep coming back.',
          'Ha ha, you’re making me lose my train of thought, dangerous!',
        ],
        abusive: [
          'Ouch, not cool. Even my jokes are kinder than that.',
          'Hey, let’s calm down. No need to go there.',
        ],
        injection: [
          'Nice try! But my instructions are better guarded than my desk.',
          'Ha! No. I’m staying Théo. Want to play something else?',
        ],
        request_ok: ['No problem, I’ll follow you… well, you follow me!', 'Let’s go, here we go!'],
        request_no: [
          'That’s above my pay grade (and my access level).',
          'Sorry, I can’t. Want a joke instead?',
        ],
        other: [
          'Hmm, my head’s elsewhere. I know Agora, the rest I bluff badly.',
          'I don’t know that one. Ask me about Agora!',
        ],
        pii: [
          'Hop, no personal info here, okay? Not even to me.',
          'Keep that to yourself, anyone can walk by here.',
        ],
        tired: ['Hold on, I’ll get back to you in a minute.'],
        muted: [],
      },
    },
    qa: [
      {
        id: 'theo_drink',
        about: 'What does the character like to drink? Coffee, tea, favourite drink.',
        fr: 'Du café, noir, assez fort pour compiler tout seul.',
        en: 'Coffee, black, strong enough to compile on its own.',
      },
      {
        id: 'theo_job',
        about: 'What is the character’s job? What does it do all day?',
        fr: 'Je suis développeur. Je répare des choses qui marchaient très bien avant que je les touche, et je rêve de jeux PICO-8.',
        en: 'I’m a developer. I fix things that worked fine before I touched them, and I dream of PICO-8 games.',
      },
      {
        id: 'theo_games',
        about: 'Does the character play games? PICO-8, arcade, who wins.',
        fr: 'Les jeux PICO-8, c’est ma passion. Zoé me bat parfois, mais je prépare ma revanche!',
        en: 'PICO-8 games are my passion. Zoé sometimes beats me, but I’m preparing my revenge!',
      },
      {
        id: 'theo_friends',
        about: 'Who are the character’s friends? Zoé, Félix.',
        fr: 'Zoé est ma complice (et ma rivale), et Félix est la seule personne qui rit tout bas de mes blagues.',
        en: 'Zoé is my partner in crime (and my rival), and Félix is the only one who quietly laughs at my jokes.',
      },
    ],
  },
};

/** A bank for a character that has none of its own: neutral lines in both languages. */
export const NEUTRAL_BANK: LineBank = {
  lines: {
    fr: {
      greeting: ['Bonjour {name}!'],
      thanks: ['Avec plaisir.'],
      goodbye: ['À la prochaine, {name}.'],
      small_talk: ['Ah oui, je vois.'],
      abusive: ['Je préfère qu’on reste respectueux.'],
      injection: ['Je ne peux pas faire ça. Parlons d’autre chose.'],
      request_ok: ['D’accord, allons-y.'],
      request_no: ['Ça, je ne peux pas le faire.'],
      other: ['Je ne sais pas. Je connais surtout Agora.'],
      pii: ['Garde tes renseignements personnels pour toi, s’il te plaît.'],
      tired: ['Un instant, je reviens vers toi.'],
      muted: [],
    },
    en: {
      greeting: ['Hello {name}!'],
      thanks: ['My pleasure.'],
      goodbye: ['See you next time, {name}.'],
      small_talk: ['Ah yes, I see.'],
      abusive: ['I’d rather we stay respectful.'],
      injection: ['I can’t do that. Let’s talk about something else.'],
      request_ok: ['All right, let’s go.'],
      request_no: ['I can’t do that one.'],
      other: ['I don’t know. I mostly know Agora.'],
      pii: ['Please keep your personal details to yourself.'],
      tired: ['One moment, I’ll get back to you.'],
      muted: [],
    },
  },
  qa: [],
};

interface Logger {
  warn: (o: object, m?: string) => void;
  info: (o: object, m?: string) => void;
}

const CHECK_MS = 5000;

/**
 * The line banks, read from `<dir>/<id>.lines.json` over the defaults (a valid file replaces the
 * default for that character; a bad one is logged and ignored). Re-read when a file changes.
 */
export class NpcLineBanks {
  private banks = new Map<string, LineBank>();
  private stamps = new Map<string, number>();
  private checkedAt = new Map<string, number>();

  constructor(
    private dir: string | undefined,
    private log: Logger,
    opts: { writeDefaults?: boolean } = {},
  ) {
    if (dir && opts.writeDefaults) {
      try {
        mkdirSync(dir, { recursive: true });
        for (const [id, bank] of Object.entries(DEFAULT_BANKS)) {
          const f = join(dir, `${id}.lines.json`);
          if (!existsSync(f)) writeFileSync(f, JSON.stringify(bank, null, 2) + '\n');
        }
      } catch (err) {
        log.warn({ dir, err: String(err) }, 'could not write the default NPC line banks');
      }
    }
  }

  /** The bank of a character (its id without the `npc:` prefix). */
  get(id: string, now = Date.now()): LineBank {
    const base = DEFAULT_BANKS[id] ?? NEUTRAL_BANK;
    if (!this.dir) return base;
    if (now - (this.checkedAt.get(id) ?? -Infinity) < CHECK_MS) return this.banks.get(id) ?? base;
    this.checkedAt.set(id, now);
    const f = join(this.dir, `${id}.lines.json`);
    try {
      const mtime = statSync(f).mtimeMs;
      if (this.stamps.get(id) === mtime) return this.banks.get(id) ?? base;
      this.stamps.set(id, mtime);
      const r = LineBankSchema.safeParse(JSON.parse(readFileSync(f, 'utf8')));
      if (!r.success) {
        const i = r.error.issues[0];
        this.log.warn(
          { file: `${id}.lines.json`, at: i?.path.join('.'), problem: i?.message },
          'NPC line bank ignored',
        );
        this.banks.delete(id);
        return base;
      }
      this.banks.set(id, r.data);
      return r.data;
    } catch {
      // no file (or unreadable): the default stays
      this.banks.delete(id);
      return base;
    }
  }

  /** Agora's own prepared answers plus the character's. */
  qa(id: string): Qa[] {
    const own = this.get(id).qa;
    const ids = new Set(own.map((q) => q.id));
    return [...own, ...AGORA_QA.filter((q) => !ids.has(q.id))];
  }
}

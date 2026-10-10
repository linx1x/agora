import { describe, expect, it } from 'vitest';
import { detectLang, personaPrefix, systemPrompt, type Persona } from './prompt.js';

const theo: Persona = {
  name: 'Théo',
  role: 'Développeur',
  personality: 'Blagueur',
  habits: 'Arrive tard',
  goals: ['Battre Zoé'],
  friends: 'Zoé',
};

describe('persona prompt', () => {
  it('names the reply language chosen by the server (deepseek-flash answered English in French otherwise)', () => {
    const en = systemPrompt(theo, [], { time: '10:00', place: 'Atrium', speaker: 'Sam', replyLang: 'en' });
    const fr = systemPrompt(theo, [], { time: '10:00', place: 'Atrium', speaker: 'Sam', replyLang: 'fr' });
    expect(en).toContain('Reply in: English.');
    expect(fr).toContain('Reply in: French (Québec).');
  });

  it('keeps the persona prefix identical across calls, so the provider cache serves it', () => {
    const a = systemPrompt(theo, ['fact'], { time: '10:00', place: 'Atrium', speaker: 'Sam', replyLang: 'en' });
    const b = systemPrompt(theo, ['fact'], { time: '16:30', place: 'Lounge', speaker: 'Julie', replyLang: 'fr', memory: 'x' });
    const prefix = personaPrefix(theo, ['fact']);
    expect(a.startsWith(prefix)).toBe(true);
    expect(b.startsWith(prefix)).toBe(true);
  });

  it('detects the language per message and keeps the previous one when unclear', () => {
    expect(detectLang('Are you an AI?')).toBe('en');
    expect(detectLang("C'est où l'aile Zen?")).toBe('fr');
    expect(detectLang('ok', 'en')).toBe('en');
    expect(detectLang('ok')).toBe('fr');
    // A character's accented name in an English message does not make it French.
    expect(detectLang('Hi Zoé! First day here, any tips?')).toBe('en');
    expect(detectLang('Félix, where can I work without being disturbed?')).toBe('en');
    expect(detectLang('Théo, tell me a joke about coffee')).toBe('en');
    expect(detectLang('Où est la bibliothèque?')).toBe('fr');
  });
});

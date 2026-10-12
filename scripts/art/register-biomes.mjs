import { readFileSync, writeFileSync } from 'node:fs';

const file = 'apps/web/public/assets/registry.json';
const registry = JSON.parse(readFileSync(file, 'utf8'));
const images = [
  'meadow-animals',
  'jungle-props',
  'jungle-animals',
  'desert-props',
  'desert-animals',
  'taiga-props',
  'taiga-animals',
  'rune-goat',
];
for (const name of images) {
  const biome = name.split('-')[0];
  const prompt =
    name === 'rune-goat'
      ? JSON.parse(readFileSync('art-src/review/biomes/rune-goat-generation.json', 'utf8')).prompt
      : biome === 'meadow'
        ? JSON.parse(readFileSync('art-src/review/biomes/meadow-generation.json', 'utf8')).prompt
        : readFileSync(`art-src/review/biomes/${biome}.md`, 'utf8');
  const path = `art-review/biomes/${name}.png`;
  const entry = {
    path,
    title: `Agora biome collection — ${name}`,
    authors: ['Vincent (Agora project)', 'OpenAI image generation'],
    license: 'Own work (AI-assisted)',
    source: 'https://openai.com/policies/terms-of-use/',
    modified: false,
    notes:
      'Original biome review artwork, 2026-10-12. Transparent source retained unchanged. Runtime atlas extraction; no third-party game art copied.',
    generation: {
      generator: 'OpenAI built-in image_gen',
      termsUrl: 'https://openai.com/policies/terms-of-use/',
      prompt,
      styleRef: 'REF-B',
    },
  };
  const index = registry.assets.findIndex((row) => row.path === path);
  if (index < 0) registry.assets.push(entry);
  else registry.assets[index] = entry;
}
writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`);
console.log(`Registered ${images.length} biome atlases.`);

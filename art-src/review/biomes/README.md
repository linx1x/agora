# Agora biome collection — revision 08

Open `http://localhost:5173/art-review.html` and use **Explore Agora** to switch
between the approved Studio and the four existing world biomes. No new biome IDs
were added. The approved materials, vegetation, existing livestock art and local
ambient wildlife now also render in the playable world. Review-only feeding and
petting demonstrations do not change production persistence or the economy.
See [production integration](production-integration.md) for scope and validation.

| Biome | Vegetation and props | Animal types |
| --- | --- | --- |
| Meadow | Approved oak, wildflowers, fern, lichen rock and pasture fence | Dairy cow, pig, hen, deer |
| Jungle | Giant tree, fern, banana understory, mossy rock, fallen log, bromeliad | Parrot, capybara, turtle |
| Desert | Oasis palm, flowering cactus, dry bush, sandstone, succulents, dry grass | Camel, fennec, desert tortoise |
| Taiga | Snow-dusted spruce, berry bush, fern and moss, snowy granite, fallen pine, mushrooms | Fox, hare, shaggy sheep |

Seven original transparent PNG atlases supply 18 new environment sprites and
52 poses for 13 animal types. Meadow environment art and the scale-reference
avatar reuse the approved Agora artwork. Each animal has idle, two walking, and
feeding poses. Atlas bounds are measured in the biome JSON manifests; the loader
uses a common pixel extent per species so a lowered head does not resize the body.

All imagery was made with the **built-in image_gen tool** and saved under
`apps/web/public/assets/art-review/biomes/`. Exact prompts and edits are recorded
in `meadow-generation.json`, `jungle.md`, `desert.md` and `taiga.md` beside this file.
The seven biome atlases and the production rune-goat atlas are recorded in
`apps/web/public/assets/registry.json`. The goat prompt is recorded in
`rune-goat-generation.json`.
`node scripts/art/register-biomes.mjs` reproduces those registry entries.

## Placement and atmosphere

The scene uses the same 35-degree, fixed-direction 2.5D view and the approved
folded footprint geometry, contact occlusion and alpha-silhouette cast shadows.
Shadows are clipped to the actual island footprint. Roots and rocks have earth
and litter clusters around their bases. Trees anchor the back and sides, while
smaller vegetation groups frame the animal paths and pond bank.

Native editable canvas materials provide meadow turf, damp jungle ground,
desert sand ripples and sandstone coloration, and taiga moss/podzol/snow patches.
The material vocabulary follows the existing block catalog; `terrain.ts` lists
the associated block IDs. Water has a sunken colored bed, submerged stones and a
separate animated reflection layer. Its deepest point is about 0.66 world tiles
below the surface. Canopies sway, birds move between perches and ground, insects
drift, and taiga snow motes fall. Motion is paused by default for reduced-motion
preferences and can be enabled explicitly.

## Animals and review interactions

Animals alternate walking, grazing and resting on a deterministic elapsed-time
timeline. Hares hop; jungle capybaras and turtles move between bank and water.
**Offer food** pauses the selected animal in its feeding pose. **Gentle pat**
settles a farm animal; for wildlife it previews a watchful response. The live
feedback states the result. These are session-only art/interaction prototypes,
not a husbandry system or a production behavior reconstruction.

Selection works through the scene and through the keyboard-accessible animal
selector. Pausing freezes the whole scene, and daylight/dusk applies a shared
tint. Switching biomes disposes the previous WebGL scene; the hidden Studio
stops rendering. Async loading protects against stale selection races and offers
a retry if an asset cannot load.

## Reference evidence

See [RESEARCH.md](./RESEARCH.md) and [reference-evidence.json](./reference-evidence.json).
REA successfully inventoried the installed Minecraft client JAR. A read-only
Stardew Content listing and official game pages informed species/material
vocabulary. Archive filenames are not evidence of AI, animation timing or
rendering behavior. No third-party game artwork was copied into Agora.

## Validation

- `node scripts/art/biome-check.mjs`: four biomes, extracted alpha and 52 distinct
  poses, animal movement, feed/pet/observe responses, pause, dusk, mobile layout,
  reduced motion, and desktop/mobile screenshots.
- `node scripts/art/botanical-check.mjs`: approved crop collection regression.
- `node scripts/art/review-check.mjs`: original scene rendering regression.
- `pnpm --filter @agora/web typecheck`, scoped ESLint and `pnpm assets:check`.

Screenshots are retained here as `meadow-scene.png`, `jungle-scene.png`,
`desert-scene.png`, `taiga-scene.png` and `biome-mobile.png` after the browser check.

Revision 08 verification: biome and botanical browser checks passed, all 11
existing art-review unit tests passed, web typecheck and scoped ESLint passed,
and the asset registry check passed with 51 entries. The biome check includes
24 prop entries (six per habitat) and all 52 animal poses.

# Agora art style guide (top-down 3/4, 32 px)

Mood board: the isometric concept board (Jungle / Oasis / Boreal Forest / Zen / Main Lobby).
We keep its palette, lighting and material language, but draw for the flat 32 px tile engine.

## Projection
- 3/4 top-down ("Stardew / Gather" view): floors seen from above, furniture and walls show their FRONT face and a thin top face.
- A wall tile = `wallTop` (roof edge, seen from above) + `wallFront` (the face below it).
- Tall objects are split in two 32 px tiles: `base` (collides) and `top` (drawn above avatars).

## Light and shade
- Light from top-left. Highlights on top/left edges, shadow on bottom/right.
- Cast shadow under furniture: 2 px, `shade` colour (black at 25%), offset down-right.
- No pillow shading, no pure black outlines.

## Outline
- 1 px selective outline in a dark tint of the material (leaf0, wood0, slate0...), not `ink`, except for metal/tech which use `metalD`.
- Floors have no outline. Props on floors do.
- Outline is drawn by the tooling (`outline()`), so shapes are drawn without it.

## Palette discipline
- Each biome has a master palette in `palettes.json` (names, not hex). Sprites use at most 12 names.
- Ramps are 4-5 steps; use adjacent steps for shading, jump two steps only for the outline and highlights.
- Hue shift: shadows lean cooler/greener, highlights lean warmer/yellower (see leaf0 to leaf5).
- Warm light (lantern/lampGlow) is the accent in every biome; it is the only saturated yellow.

## Texture
- Floors: 2-3 tone seeded noise, sparse 1 px detail (grass blades, plank seams, sand specks). Must tile seamlessly: wrap-around noise.
- Foliage: clustered 2-3 px leaf blobs with one highlight leaf per cluster; avoid uniform noise.
- Wood: 2 px plank lines, one lighter top edge.
- Water: 3-step bands with sparkles; animated tiles shift bands by 2 px per frame.

## Biome identity (from the board)
| Biome | Material | Light | Accent |
|---|---|---|---|
| Jungle | natural wood, moss, vines, wet stone | warm, humid, lantern amber | arcade blue/red, flowers |
| Oasis | light wood, sandstone, plaster, palms | soft warm sand | turquoise water |
| Boreal | dark wood, slate, pines, glass | cool crisp blue | fire orange |
| Zen | pale wood, tatami, shoji, bonsai | soft diffuse cream | lotus purple |
| Hub | warm stone plaza, asphalt road with yellow dashes | warm, neutral | brass, great tree |

## Naming and files
- Tile key = `<biome>.<base>` exactly as in `packages/shared/src/tileset.ts` (e.g. `jungle.deskH`).
- Source lives in `art-src/<biome>/*.py`; sheet output `apps/web/public/assets/agora/<biome>.png` (8 columns x 32 px).
- Animated: `agora/anim/<name>.png`, 4 frames side by side, frame 0 = reduced-motion still.

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

## 3D rules (2.5D view, ADR-052)

The 2.5D view draws the same 32 px art on 3D shapes, so most tiles need no new art. The shape of a
tile comes from `packages/shared/src/shape3d.ts`; a tile may override it with `TileDef.d3`.

- **Camera.** Fixed tilt of 35°, facing north, perspective, never rotating. Every piece has one good
  side, the south face, which faces the camera. Draw it for that side.
- **Light.** The 2D light rule still holds (light from the top left). In 3D the sun moves east,
  south, west, and the engine adds lit, front and side shade as vertex colours. So do not bake a
  side band into a tile that the 3D view uses: paint the material's base colours and the 2 px
  contact shadow only.
- **Shapes and what the art must show.**
  - `flat` (floor, rug, mat, water, path, pond edge, fire pit): drawn from above, no front face. It
    lies on the floor.
  - `wall` (`wallTop`, `wallFront`, `window`, `glassDoor`): a 1.5-tile box. The `wallTop` tile is its
    top; the tile below it is its face.
  - `box` (desk, table, counter, reception, pool and ping-pong tables): one tile extruded. Rows above
    the split row are the top face, rows below are the front. The split row of each tile is in
    `SPLIT` in `shape3d.ts` (desk 21, table 20, counter 20, coffee table 22). A new box tile needs its
    split row read off its art and added there.
  - `card` (plants, lamps, sofas, shelves, trees): stands on its lowest opaque row, so the bottom row
    is the base on the floor. Tiles stacked north to south (`column`: a tree and its crown, the two
    halves of a cabinet, a waterfall) become one card.
  - `decal` (vines): hangs on the wall face north of its cell.
  - `none`: blockers that draw nothing.
- **Height and occlusion.** A card at least 0.9 tiles tall is an occluder: it fades to about 30 %
  when it hides a person (P16.9). Keep the lower part of a tall object open so the figure stays
  readable behind it.
- **Characters.** Do not paint people or NPCs into tiles. They are separate 64×96 smooth paper
  cut-outs; the world is pixel art. At 45° and steeper the upright cut-outs look flatter, which is
  why the tilt is 35°.
- **Shadows.** Blob shadows and the sun shadow are generated. Paint only the 2 px contact shadow.
- **Personal worlds (ADR-053, P17.15).** A world block in 2.5D is a stepped column: its top is the
  24-row top face and its side is the 8-row side band repeated down the column, as in the flat
  view (`apps/web/src/worlds/blockArt.ts`). Decor is one card. Confirm this at P17.15 before
  drawing world art in bulk.
- **What needs new art.** (1) A tile whose shape the rules cannot extrude (two faces, an arch, a
  tiered object): draw it, then give it a `d3` override with a test. (2) A new biome look (new ramp
  names in `palettes.json`). (3) An animated tile (frames side by side, `agora/anim/`). (4) Any
  world block, its top and side, as listed in `docs/ASSETS.md` § Worlds. Walls, floors and plain
  furniture already have shapes and need no new art.
- **Test.** `packages/shared/src/shape3d.test.ts` checks that every tile placed in the Atrium and the
  wings has a shape (blockers excepted). A new tile fails that test until it has one.

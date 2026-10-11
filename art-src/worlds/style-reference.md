# Personal worlds: style reference (ADR-053, P17.38)

Applies to every sprite of a personal world: blocks, decor, tools, crops, items, UI and seasonal
overlays. The office keeps its own guide (`art-src/style-guide.md`) and its own palettes; this file
adds the world rules and names the reference sheets. Each row of the manifest in `docs/ASSETS.md`
§ Worlds names the sheet to match (`REF-A` to `REF-F`).

No art file is added by this document. Until a sheet is drawn, its "source today" column is the
reference: the code draws the same things, so a new drawing must read the same at a glance.

## 1. Pixel density

- One cell is one 32 × 32 px tile (`WORLD_CELL_PX`). Draw on the grid: no sub-pixel positions, no
  anti-aliasing, no soft edges. The renderer scales with nearest neighbour.
- **Ground and solid blocks:** top face 32 × 24 px (rows 0–23), side band 32 × 8 px (rows 24–31).
  The flat view repeats the side band down a cliff; the 2.5D view uses it as the front face.
- **Decor:** the whole 32 × 32 frame, transparent around the object, the object's base on the bottom
  row (its floor point).
- **Tall decor** (`height` ≥ 2 in `blocks.json`): a base tile and a crown tile above it, one 32 × 64
  sheet. In 2.5D the two are one upright card.
- **Icons** (tools, items, UI): 32 × 32, or 16 × 16 where the row says so.
- A sprite uses at most 12 names of its batch palette (the office rule).

## 2. Light

- Light from the top left, as the office guide: highlights on the top and left edges, shade on the
  bottom and right. A 2 px contact shadow in the shade colour, offset down right, is the only cast
  shadow painted into the art.
- In 2.5D the sun moves (east, south, west) and the engine adds lit, front and side shade as vertex
  colours. Do not bake a side shade into a top face. The 8-row side band is the material's own dark
  step, as in the flat view.
- Warm light is the accent of every biome: the lamp ramp of the batch (`lantern` in Jungle, `brass`
  elsewhere) only. The campfire's `fire` ramp is the one exception.

## 3. Outline

- 1 px selective outline in a dark tint of the material: `wood0` for wood, `leaf0` or the biome's
  `moss0` for foliage, `stone0` for stone, `water0` for the shore of water. Not `ink`, except metal
  (`metalD`), which the world does not use yet.
- Ground tiles and floors have no outline. Decor on the ground has one. A shore has one.
- Generated art (see §6) is never used at the generator's size or colours. It is resampled to the
  32 px grid, snapped to the batch palette by hand, outlined by this rule, and only then saved.

## 4. Palette per batch

The batch palette is one biome's master palette in `art-src/palettes.json`, named in
`packages/shared/data/worlds/biomes.json`. Shared rows (water, sand, stone, boulder, tilled soil and
the starter's blocks) use `zen`, as the placeholders do. Names are the keys of `palettes.json`;
hex values are for checking only.

- **Meadow** (`zen`, Zen wing): bons0 `#23441e` · bons1 `#3c6a30` · bons2 `#5c8a4a` · bons3 `#86b363`
  · pot `#6b4a35` · potL `#8f6a4c` · wood0 `#4a2a18` · wood1 `#7a4a2c` · wood2 `#a97d58` · stone0
  `#5d5a50` · stone1 `#8a8576` · stone2 `#b8b3a1` · stone3 `#dcd8c8` · tatami1 `#d2c496` · tatami2
  `#e6dab4` · tile0 `#1f3a5a` · tile1 `#3f6a94` · tile2 `#bcd8ec` · lotus `#8c7fb8` · lotusL `#b9aede`
  · flower `#e8708a` · flowerY `#f4d65a` · flowerW `#fff2f6` · flowerP `#f0a8c0`
- **Jungle** (`jungle`, Jungle wing): leaf0 `#0f2e0e` · leaf1 `#1b4a16` · leaf2 `#2f7226` · leaf3
  `#4a9a33` · leaf4 `#77c043` · moss0 `#21481b` · moss1 `#2a5822` · moss2 `#33672a` · moss3 `#44823a`
  · dirt0 `#3a2716` · dirt1 `#5c3e22` · dirt2 `#7d5730` · wood0 `#3b2412` · wood1 `#6a3f1d` · wood2
  `#9a5f2b` · stone0 `#2c332c` · stone1 `#4b5649` · stone2 `#718068` · water0 `#145f6e` · water1
  `#2a9aa8` · water2 `#6cd0d0` · flower `#f27a6b` · flowerY `#f6d65a` · flowerP `#cf8ae0` · lantern
  `#f4b73f` · lanternL `#ffe28a`
- **Desert** (`oasis`, Oasis wing): sand0 `#b98f58` · sand1 `#d9b27a` · sand2 `#ecc994` · sand3
  `#f8deac` · stone0 `#8d6e48` · stone1 `#b99a6b` · stone2 `#d6bd92` · wood0 `#7a5230` · wood1
  `#a97a44` · wood2 `#cfa468` · palm0 `#1d4a2a` · palm1 `#2f7a3c` · palm2 `#4fa044` · palm3
  `#86c85a` · terra `#c8703a` · terraD `#8c4a26` · turq1 `#25aab8` · turq2 `#6cdcd4`
- **Taiga** (`boreal`, Boreal wing): pine0 `#08241a` · pine1 `#11402f` · pine2 `#1f6648` · pine3
  `#3a8a62` · pine4 `#74b890` · wood0 `#2a170d` · wood1 `#4a2a18` · wood2 `#6e4026` · snow0 `#9fb8c8`
  · snow1 `#dfeaf1` · slate1 `#1a2a38` · slate2 `#27405a` · slate3 `#3d5f7e` · rock1 `#4a565e` · rock2
  `#76848c` · water1 `#8fc4e0` · water2 `#cbe9f6` · fire0 `#a8331a` · fire1 `#ee7a2a` · fire2 `#ffc24a`

Palette changes are per batch: a new batch that changes a hex value is a new look, so it needs
Vincent's review (art direction) before the rows use it.

## 5. Reference sheets

| Id | What it is | Size and layout | Source today (until drawn) | Rows that use it |
|---|---|---|---|---|
| REF-A | Ground: one biome's ground blocks, top and side, plus its path and ice | 32 × 32 per block (top 32 × 24, side 32 × 8), shown in a row per biome | `apps/web/src/worlds/placeholders.ts` (`renderTile`, the `LOOKS` table) | every ground row |
| REF-B | Props and decor: trees, plants, rocks, furniture, lights, pieces that stand | 32 × 32, or 32 × 64 for tall decor; base on the bottom row | placeholder decor shapes (`blob`, `tree`, `post`, `box`) in `placeholders.ts` | every decor row, the shared decor |
| REF-C | Tools: sprites for the swing in four facings, three swing frames each | 32 × 32 per frame, frames named `swing-<facing>-<n>` (`tools/swing.ts`) | `apps/web/src/worlds/tools/swing.ts`, `overlay.ts` (the tier mark is code) | tool rows |
| REF-D | UI: hotbar slot frames, energy, clock, coin, bag, refusal icons | 16 × 16 (inline) and 32 × 32 (toast) | text only today; the office UI icons in `art-src/common/` for weight | UI rows |
| REF-E | Items and crops: crop growth frames 0 to 4 (4 is ripe), item icons | 32 × 32 per frame | `apps/web/src/worlds/blockArt.ts` (crop frames) | crop and item rows |
| REF-F | Seasonal: decor and unique items of a season (P17.37); season tints are code | 32 × 32 or 32 × 64, the same grid | none yet | seasonal rows |

Rules for every sheet: one object per cell, the same light and outline as §2 and §3, the batch
palette of its biome (§4). Shared sheets (REF-C to REF-F) use the `zen` palette, as the shared rows do.

## 6. Prompts for AI-assisted art

Rows made with an image generator are licensed `Own work (AI-assisted)` (`docs/ASSETS.md`, Allowed
licenses). Each such row stores its filled prompt and the id of the sheet it followed. The prompt
skeleton, per sheet, is:

> Pixel art, exactly {W}×{H} pixels, one {subject}, centred on a transparent background, base on
> the bottom row. Top-left light, one-pixel dark outline in the dark tint of the material, flat
> colours only from this list: {names and hex from §4}. No text, no border, no anti-aliasing, no
> photographic detail. Style: {REF id} from the reference sheet.

Prompts never name a game, a studio, an artist or a living person, and never ask for a copy of
existing art (clean room, ADR-053). The generator's name and its terms URL go in the registry row,
and the terms are checked before each batch: some generators restrict commercial use or ask for
credit.

## 7. What a finished row needs

1. A file at `apps/web/public/assets/worlds/<biome or shared>/<name>.png` (the sprite key plus
   `.png`), 32 px grid, the sizes of §1.
2. A registry row: licence `Own work (AI-assisted)`, `authors` with `Vincent`, and the `generation`
   object (`generator`, `termsUrl`, `prompt`, `styleRef` = `REF-A` to `REF-F`). `pnpm assets:check`
   refuses the row without them.
3. The block id in `packages/shared/data/worlds/blocks.json` (a row with the sprite key) for block
   art; tools, items, crops and UI need their own loader.
4. The loader. `resolveTile(sprite, files)` picks a file over the placeholder, but no code builds
   the `files` map yet: the flat view draws placeholders only. The first drawn row waits for that
   small task, which is not part of P17.38.
5. The row's status in `docs/ASSETS.md` § Worlds changed from "to add" to "drawn".

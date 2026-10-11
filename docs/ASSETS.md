# Assets: sources and licensing

Rule: use existing free-licensed art; do not draw new sprites. Every file is
recorded in `apps/web/public/assets/registry.json` and shown on the Credits page.

## Allowed licenses

- **CC0** — no obligations (credit appreciated).
- **CC-BY 3.0/4.0, OGA-BY 3.0** — attribution required.
- **CC-BY-SA 3.0/4.0** — attribution required; modified art (e.g. recoloured
  sprites) must stay under the same license. Fine for an internal tool; keep the
  license on any derivative files.
- **GPL 3.0 (art only)** — acceptable when dual-licensed with CC-BY-SA (choose
  CC-BY-SA in the registry).
- **Own work (AI-assisted)** — Vincent's own pictures, made with an AI image generator (ADR-053).
  Accepted only when the row has `authors` with `Vincent` and a `generation` object with:
  `generator` (the generator's name), `termsUrl` (an https link to its terms, checked before each
  batch), `prompt` (the filled prompt, `art-src/worlds/style-reference.md` §6), and `styleRef`
  (`REF-A` to `REF-F`, the reference sheet it followed). `pnpm assets:check` refuses the row without
  them (`scripts/assets-rules.ts`). The generator's output is used only after the clean-up in the
  style reference (§3). Generator terms can restrict commercial use or ask for credit; checking them
  is part of each batch.

Not allowed: "free for personal use", "non-commercial", licenses that forbid
redistribution of the files in a repo, anything with unclear provenance, AI-
generated packs made by others without a clear license (only Vincent's own rows use the
own-work licence). When unsure, leave it out and flag it.

_This is engineering guidance, not legal advice; your organization may want its legal team to
glance at the final registry._

## Primary choice: LPC (Liberated Pixel Cup) family

Why: one consistent 32 px style for both tiles and characters, and the character
art is **layered** (body, hair, clothes, hats, accessories), which gives avatar
customization and the full wardrobe without drawing anything.

**Characters** — Universal LPC Spritesheet Character Generator
(github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator).

- Use the individual layer PNGs from its `spritesheets/` folder, not baked
  characters, so the client can composite layers.
- Its `CREDITS.csv` lists author, license and URL per image. Copy the rows for
  every layer used into `registry.json` and ship the CSV with the app.
- Curate a starting catalog (~8 skin tones, ~15 hair styles × ~8 colours,
  ~20 tops, ~10 bottoms, shoes, glasses, ~10 hats/accessories). Prefer layers that
  include walk animation in 4 directions; include sit animation where available
  (for chairs).

**Tiles and furniture** — LPC interior sets on OpenGameArt.org (search the
"LPC - Indoor Tiles" and "LPC Compatible Terrain/Tiles" collections). LPC is
fantasy-leaning, so modern office pieces (monitors, office chairs, whiteboards,
meeting tables) may be thin. Survey procedure (task P0.9):

1. Collect LPC-compatible 32 px interior/modern packs with allowed licenses.
2. If office furniture is missing, look for CC0 top-down packs whose style mixes
   acceptably (Kenney's "Roguelike Indoor" and similar are CC0 but 16 px; a 2×
   nearest-neighbour scale is allowed if it looks coherent next to LPC).
3. Build the test room and screenshot it for HUMAN CHECKPOINT A.
4. Record every pack in the registry before any map uses it.

**UI icons** — Lucide (ISC) or Phosphor (MIT) for interface icons. Emote
glyphs from a CC0/CC-BY pixel icon pack or Twemoji (CC-BY 4.0 graphics).

**Sounds** — notification/knock/door sounds from Kenney audio packs (CC0) or
freesound.org items marked CC0.

**Fonts** — Atkinson Hyperlegible (SIL OFL) for UI; see DESIGN.md.

## registry.json shape

```json
{
  "assets": [
    {
      "path": "tiles/lpc-interior/walls.png",
      "title": "LPC Interior Castle Tiles",
      "authors": ["..."],
      "license": "CC-BY-SA 3.0",
      "source": "https://opengameart.org/content/...",
      "modified": false,
      "notes": ""
    }
  ]
}
```

`pnpm assets:check` fails the build if a file under `public/assets` has no entry
or an entry uses a license outside the allowed list. An own-work row (licence
`Own work (AI-assisted)`) also carries the `generation` object:

```json
{
  "path": "worlds/meadow/grass.png",
  "title": "Meadow grass tile (AI-assisted)",
  "authors": ["Vincent"],
  "license": "Own work (AI-assisted)",
  "source": "",
  "modified": false,
  "notes": "Meadow ground, sheet REF-A",
  "generation": {
    "generator": "<generator name>",
    "termsUrl": "https://<generator terms page>",
    "prompt": "<the filled prompt>",
    "styleRef": "REF-A"
  }
}
```

## Current state (2026-10-01, ADR-020)

In use: Kenney "Roguelike/RPG pack" and "Roguelike Indoors" (CC0) in
`apps/web/public/assets/kenney/` for plants, trees, hedges, chairs, bookshelves,
fireplace and water. Everything else is procedural placeholder art drawn in code.
Reviewed and not used: CraftPix free assets (licence forbids redistributing the
source files, so they cannot live in the repo), LimeZu Modern Office/Interiors on
itch.io (paid, no redistribution), GameArt2D freebies (CC0 but side-view).

## Current state (2026-10-02, ADR-022)

Original Agora pixel art (CC0, `assets/agora/`): shared chairs, desk props, drinks, UI icons
(`common`), Hub fixtures and animated tiles (`hub`), the whole Jungle biome (`jungle`), the whole Oasis biome (`oasis`) the whole Boreal biome (`boreal`) and the whole Zen biome (`zen`).
Built from `art-src/` with `python3 scripts/art/build.py <biome>`; see `art-src/style-guide.md`.
The Jungle wing uses all of it (ADR-023): paths, pond, waterfall, hammock, arcades, sofa sections,
board game and VR are tile types now. Pond, waterfall, Hub water, portals and fireplaces animate.
The Oasis wing uses its sheet the same way (ADR-024): fountain pool, cabanas, sandstone paths, pool table, ping-pong. The Boreal wing follows (ADR-025): fire pit, frozen pond, slate paths, TV and console. The Zen wing is done too (ADR-026): koi pond, flagstone paths, water basin, tea, go and jigsaw tables. The Hub floors, walls, windows, plants, tree, rugs, lamp, table and sofa are drawn too (ADR-027, `art-src/hub/atrium.py`), so the Atrium no longer needs Kenney art for those tiles (Kenney stays as a fallback for any tile without a sprite).

## Current state (2026-10-11, ADR-052, ADR-053)

- **Office art is unchanged.** The 2.5D view (ADR-052; the only view since ADR-054)
  draws the same tiles on 3D shapes (`packages/shared/src/shape3d.ts`). Jungle, Atrium, Oasis,
  Boreal and Zen needed no new art to get their shapes (P16.12, P16.16, P16.17).
- **Paper avatars** for the 2.5D view are drawn in code: `generated:characters/agora-paper-avatars`
  (CC0, P16.7), listed on the Credits page.
- **Personal worlds** (ADR-053, flag `worlds`, off) show placeholders only: each block is a 32 px
  tile drawn in code from its biome palette (`apps/web/src/worlds/placeholders.ts`). No world sprite
  file is in the registry yet. The art manifest (P17.38) is in § Worlds below.
- **3D rules** for new art (shape kinds, the split rows of boxes, cards, what needs new art) are in
  `art-src/style-guide.md`, § 3D rules.

## Worlds (ADR-053, P17.13, P17.38)

The art of personal worlds, row by row, for Vincent's generator and for the artists. Each row names
its reference sheet (`REF-A` to `REF-F`, `art-src/worlds/style-reference.md`), which holds the pixel
density, the light, the outline and the batch palette of each biome.

- **Status.** *placeholder*: drawn in code from the biome palette (`apps/web/src/worlds/placeholders.ts`),
  what the game shows today. *to add*: the id is not in `blocks.json` yet; add its row there
  (`agora-add-world-content`) before drawing it. *drawn*: a file is in the registry (none yet).
- **Keys and sizes.** Sprite key `worlds/<biome>/<name>` or `worlds/shared/<name>`, the same name as the
  file without `.png`. A ground block is a top face (32 × 24 px) and a side band (32 × 8 px); a solid
  block is a box with the same two faces; a decor is 32 × 32 with a transparent surround; a tall decor
  (height 2 or more) is 32 × 64, a base tile and a crown tile.
- **Nothing is drawn yet.** The game does not load sprite files: `resolveTile` exists, but no code builds
  its file map (style reference §7). Every row below is a placeholder or to add.
- **Count.** Each biome has 15 to 20 rows: its own blocks from `blocks.json`, the shared blocks it shows
  (listed once in the shared table and repeated by id in each biome), and the blocks to add.

### Shared blocks (every biome)

| Id | Sprite key | Size | States | Ref | Status |
|---|---|---|---|---|---|
| `stone` | `worlds/shared/stone` | ground | — | REF-A | placeholder (deep layer of every biome) |
| `gravel` | `worlds/shared/gravel` | ground | — | REF-A | placeholder (not used by the generator or the starter; decide at P17.24) |
| `sand` | `worlds/shared/sand` | ground | — | REF-A | placeholder (beaches) |
| `water` | `worlds/shared/water` | ground, liquid | animated, 4 frames (bands move 2 px) | REF-A | placeholder (every biome) |
| `tilled_soil` | `worlds/shared/tilled` | ground | dry, wet | REF-A | placeholder (tillable ground) |
| `boulder` | `worlds/shared/boulder` | decor, box | — | REF-B | placeholder (pick) |
| `wood_wall` | `worlds/shared/wood_wall` | decor, box, solid | — | REF-B | placeholder (axe) |
| `torch` | `worlds/shared/torch` | decor, light 14 | — | REF-B | placeholder |
| `stone_stairs` | `worlds/shared/stone_stairs` | decor, ramp | — | REF-B | placeholder |
| `wood_floor` | `worlds/shared/wood_floor` | ground | — | REF-A | placeholder (house floor) |
| `return_pad` | `worlds/shared/return_pad` | ground | — | REF-A | placeholder (back to the office) |
| `bed` | `worlds/shared/bed` | decor, box, solid | — | REF-B | placeholder |
| `shipping_bin` | `worlds/shared/shipping_bin` | decor, box, solid | — | REF-B | placeholder |
| `shop_board` | `worlds/shared/shop_board` | decor, box, solid | — | REF-B | placeholder |

### Meadow (palette `zen`): 17 rows

| Id | Sprite key | Size | States | Ref | Status |
|---|---|---|---|---|---|
| `meadow_grass` | `worlds/meadow/grass` | ground | — | REF-A | placeholder |
| `meadow_dirt` | `worlds/meadow/dirt` | ground | — | REF-A | placeholder (subsurface) |
| `tall_grass` | `worlds/meadow/tall_grass` | decor | — | REF-B | placeholder |
| `flower` | `worlds/meadow/flower` | decor | — | REF-B | placeholder |
| `oak_tree` | `worlds/meadow/oak` | tall decor, solid | — (cut: bare ground) | REF-B | placeholder (axe) |
| `water` | `worlds/shared/water` | see shared table | see shared table | REF-A | shared |
| `sand` | `worlds/shared/sand` | see shared table | see shared table | REF-A | shared |
| `stone` | `worlds/shared/stone` | see shared table | see shared table | REF-A | shared |
| `tilled_soil` | `worlds/shared/tilled` | see shared table | see shared table | REF-A | shared |
| `boulder` | `worlds/shared/boulder` | see shared table | see shared table | REF-B | shared |
| `meadow_path` | `worlds/meadow/path` | ground | — | REF-A | to add (trodden earth) |
| `meadow_clover` | `worlds/meadow/clover` | decor | — | REF-B | to add |
| `berry_bush` | `worlds/meadow/berry_bush` | decor, harvest by hand | bare, berries | REF-B | to add |
| `mushroom` | `worlds/meadow/mushroom` | decor, harvest by hand | — | REF-B | to add |
| `birch_tree` | `worlds/meadow/birch` | tall decor, solid, axe | — (cut: `stump`) | REF-B | to add |
| `stump` | `worlds/meadow/stump` | decor, low | — | REF-B | to add (what a cut tree leaves; P17.21 leaves bare ground) |
| `fence` | `worlds/meadow/fence` | decor, solid | — | REF-B | to add |

### Jungle (palette `jungle`): 17 rows

| Id | Sprite key | Size | States | Ref | Status |
|---|---|---|---|---|---|
| `jungle_grass` | `worlds/jungle/grass` | ground | — | REF-A | placeholder |
| `jungle_mud` | `worlds/jungle/mud` | ground | — | REF-A | placeholder (subsurface) |
| `fern` | `worlds/jungle/fern` | decor | — | REF-B | placeholder |
| `jungle_tree` | `worlds/jungle/tree` | tall decor, solid | — | REF-B | placeholder (axe, tier 2) |
| `water` | `worlds/shared/water` | see shared table | see shared table | REF-A | shared |
| `sand` | `worlds/shared/sand` | see shared table | see shared table | REF-A | shared |
| `stone` | `worlds/shared/stone` | see shared table | see shared table | REF-A | shared |
| `tilled_soil` | `worlds/shared/tilled` | see shared table | see shared table | REF-A | shared |
| `boulder` | `worlds/shared/boulder` | see shared table | see shared table | REF-B | shared |
| `jungle_path` | `worlds/jungle/path` | ground (mossy stone) | — | REF-A | to add |
| `vine` | `worlds/jungle/vine` | decor, hangs on a cliff face (a decal in 2.5D) | — | REF-B | to add |
| `bamboo` | `worlds/jungle/bamboo` | tall decor, solid, axe | — | REF-B | to add |
| `orchid` | `worlds/jungle/orchid` | decor | — | REF-B | to add |
| `banana_plant` | `worlds/jungle/banana` | decor, harvest by hand | bare, fruit | REF-B | to add |
| `broad_leaf` | `worlds/jungle/broad_leaf` | decor | — | REF-B | to add |
| `tiki_totem` | `worlds/jungle/tiki` | tall decor, solid, placeable | — | REF-B | to add |
| `lantern` | `worlds/jungle/lantern` | decor, placeable, light 12 | unlit, lit | REF-B | to add |

### Desert (palette `oasis`): 18 rows

Desert sand is not tillable (`blocks.json`), so `tilled_soil` does not appear in this biome.

| Id | Sprite key | Size | States | Ref | Status |
|---|---|---|---|---|---|
| `desert_sand` | `worlds/desert/sand` | ground | — | REF-A | placeholder |
| `desert_sandstone` | `worlds/desert/sandstone` | ground | — | REF-A | placeholder (subsurface) |
| `dead_bush` | `worlds/desert/dead_bush` | decor | — | REF-B | placeholder |
| `cactus` | `worlds/desert/cactus` | tall decor, solid | — | REF-B | placeholder |
| `palm` | `worlds/desert/palm` | tall decor, solid | — | REF-B | placeholder (axe) |
| `water` | `worlds/shared/water` | see shared table | see shared table | REF-A | shared |
| `sand` | `worlds/shared/sand` | see shared table | see shared table | REF-A | shared |
| `stone` | `worlds/shared/stone` | see shared table | see shared table | REF-A | shared |
| `boulder` | `worlds/shared/boulder` | see shared table | see shared table | REF-B | shared |
| `desert_pebbles` | `worlds/desert/pebbles` | ground | — | REF-A | to add |
| `sandstone_path` | `worlds/desert/path` | ground (cut slabs) | — | REF-A | to add |
| `agave` | `worlds/desert/agave` | decor | — | REF-B | to add |
| `barrel_cactus` | `worlds/desert/barrel_cactus` | decor, solid | — | REF-B | to add |
| `flowering_cactus` | `worlds/desert/flowering_cactus` | decor, solid | bare, flower | REF-B | to add |
| `bones` | `worlds/desert/bones` | decor | — | REF-B | to add |
| `tumbleweed` | `worlds/desert/tumbleweed` | decor | still, 4 frames (rolling) | REF-B | to add |
| `sandstone_wall` | `worlds/desert/sandstone_wall` | decor, box, solid, placeable | — | REF-B | to add |
| `ruin_pillar` | `worlds/desert/pillar` | tall decor, solid | — | REF-B | to add |

### Taiga (palette `boreal`): 17 rows

| Id | Sprite key | Size | States | Ref | Status |
|---|---|---|---|---|---|
| `taiga_moss` | `worlds/taiga/moss` | ground | — | REF-A | placeholder |
| `taiga_podzol` | `worlds/taiga/podzol` | ground, tillable | — | REF-A | placeholder (subsurface) |
| `taiga_snow` | `worlds/taiga/snow` | ground (alpine) | — | REF-A | placeholder |
| `spruce` | `worlds/taiga/spruce` | tall decor, solid | — | REF-B | placeholder (axe) |
| `water` | `worlds/shared/water` | see shared table | see shared table | REF-A | shared |
| `sand` | `worlds/shared/sand` | see shared table | see shared table | REF-A | shared |
| `stone` | `worlds/shared/stone` | see shared table | see shared table | REF-A | shared |
| `tilled_soil` | `worlds/shared/tilled` | see shared table | see shared table | REF-A | shared |
| `boulder` | `worlds/shared/boulder` | see shared table | see shared table | REF-B | shared |
| `taiga_path` | `worlds/taiga/path` | ground (packed snow) | — | REF-A | to add |
| `taiga_ice` | `worlds/taiga/ice` | ground, walkable (frozen shore) | — | REF-A | to add |
| `snow_bush` | `worlds/taiga/snow_bush` | decor | — | REF-B | to add |
| `lingonberry` | `worlds/taiga/lingonberry` | decor, harvest by hand | bare, berries | REF-B | to add |
| `frost_fern` | `worlds/taiga/frost_fern` | decor | — | REF-B | to add |
| `log_pile` | `worlds/taiga/log_pile` | decor, solid, axe | — | REF-B | to add |
| `campfire` | `worlds/taiga/campfire` | decor, placeable, light 12 | unlit, lit (4 frames) | REF-B | to add |
| `larch` | `worlds/taiga/larch` | tall decor, solid, axe | — (autumn tint is code) | REF-B | to add |

### Tools (REF-C): five kinds, three tiers each

Five kinds in `tools.json`: hoe, can, axe, pick and rod. The brief named four; the rod is the fifth, and
its art waits for fishing (P17.34). Each tool sheet holds the four facings (`up`, `down`, `left`,
`right`) and the three swing frames of each (`swing-<facing>-<n>`, 12 frames). The tier mark (one to
three pixels, bottom right, in an 8 × 8 grid) is drawn in code (`tools/overlay.ts`), so tiers 2 and 3
need no art: a new head (iron, diamond) is optional and falls back to the tier 1 sheet.

| Tool id | Sprite key | Art | Status |
|---|---|---|---|
| `hoe_1` | `worlds/tools/hoe_1` | 4 facings × 3 swing frames | to add (required) |
| `hoe_2` | `worlds/tools/hoe_2` | optional new head (iron); else `hoe_1` + mark | to add (optional) |
| `hoe_3` | `worlds/tools/hoe_3` | optional new head (diamond); else `hoe_1` + mark | to add (optional) |
| `can_1` | `worlds/tools/can_1` | 4 facings × 3 swing frames | to add (required) |
| `can_2` | `worlds/tools/can_2` | optional new head; else `can_1` + mark | to add (optional) |
| `can_3` | `worlds/tools/can_3` | optional new head; else `can_1` + mark | to add (optional) |
| `axe_1` | `worlds/tools/axe_1` | 4 facings × 3 swing frames | to add (required) |
| `axe_2` | `worlds/tools/axe_2` | optional new head; else `axe_1` + mark | to add (optional) |
| `axe_3` | `worlds/tools/axe_3` | optional new head; else `axe_1` + mark | to add (optional) |
| `pick_1` | `worlds/tools/pick_1` | 4 facings × 3 swing frames | to add (required) |
| `pick_2` | `worlds/tools/pick_2` | optional new head; else `pick_1` + mark | to add (optional) |
| `pick_3` | `worlds/tools/pick_3` | optional new head; else `pick_1` + mark | to add (optional) |
| `rod_1` | `worlds/tools/rod_1` | cast frames, specified with P17.34 | waits for fishing |
| `rod_2` | `worlds/tools/rod_2` | as `rod_1`; optional new head | waits for fishing |
| `rod_3` | `worlds/tools/rod_3` | as `rod_1`; optional new head | waits for fishing |

### Crops (REF-E): 18 crops, five frames each

`CROP_FRAMES` is 5: frames 0 to 3 are growth, frame 4 is ripe (`cropFrame`, `view2d/math.ts`). The stage
index is `floor(stage)`, clamped to 0 to 3, so a crop with fewer stages still needs all five frames: its
middle frames are intermediate growth. Sprite key `worlds/crops/<id>`, 32 × 32 per frame. The stages are
in days, from `crops.json`. Status: all to add; none is drawn.

| Crop id | Seasons | Stages (days) | Regrows | Status |
|---|---|---|---|---|
| `dawn_radish` | spring | 3, 4 | no | to add |
| `clover_bulb` | spring, autumn | 4, 4, 4 | no | to add |
| `meadow_kale` | spring | 5, 5, 4 | no | to add |
| `honey_pea` | spring | 4, 3, 3 | 4 days | to add |
| `pearl_onion` | spring | 5, 4, 4 | no | to add |
| `ember_pepper` | summer | 4, 4, 5 | 3 days | to add |
| `river_melon` | summer | 6, 6, 6 | no | to add |
| `gold_maize` | summer | 4, 5, 5, 4 | no | to add |
| `sun_tomato` | summer | 4, 4, 4 | 4 days | to add |
| `silk_squash` | summer | 5, 5, 5, 5 | no | to add |
| `amber_pumpkin` | autumn | 7, 7, 7 | no | to add |
| `mist_grape` | autumn | 5, 5, 5, 4 | 4 days | to add |
| `rust_yam` | autumn | 5, 5, 5 | no | to add |
| `plum_bean` | autumn | 4, 4, 4 | 3 days | to add |
| `reed_rice` | autumn | 4, 4, 4 | no | to add |
| `frost_cabbage` | winter | 6, 6, 6 | no | to add |
| `snow_lettuce` | winter | 4, 4, 4 | no | to add |
| `ice_berry` | winter | 5, 5, 5 | 4 days | to add |

### Caves (REF-A ground, REF-B ore nodes; P17.32)

Cave maps behind cave mouths (`caves.ts`). Sprite keys as listed, 32 × 32, top and side faces for 2.5D. Status: all to add; drawn as code placeholders.

| Block id | Layer | Sprite key | Harvestable | Where |
|---|---|---|---|---|
| `cave_floor` | ground | `worlds/shared/cave_floor` | no | cave (P17.32) |
| `cave_rock` | ground | `worlds/shared/cave_rock` | no | cave (P17.32) |
| `cave_mouth` | decor | `worlds/shared/cave_mouth` | no | cave mouth in every biome (P17.32) |
| `ore_copper` | decor | `worlds/shared/ore_copper` | yes | cave, near the mouth (P17.32) |
| `ore_iron` | decor | `worlds/shared/ore_iron` | yes | cave, middle depths (P17.32) |
| `ore_gold` | decor | `worlds/shared/ore_gold` | yes | cave, deepest (P17.32) |

### UI (REF-D)

Sizes are the art size. Text (names, refusal messages) is in the `fr` and `en` strings (`worlds.refused.<reason>`);
a Lucide icon (ISC, in the registry) can stand in for any of these until the art lands.

| Element | Sprite key | Size | States | Status |
|---|---|---|---|---|
| Hotbar slot (nine slots) | `worlds/ui/slot` | frame 40 × 40 around a 32 px icon | empty, filled, selected | to add |
| Energy | `worlds/ui/energy` | 16 × 16 | normal, low | to add |
| Money (coin) | `worlds/ui/coin` | 16 × 16 | — | to add |
| Inventory button (bag) | `worlds/ui/bag` | 16 × 16 | — | to add |
| Clock: day and night | `worlds/ui/day`, `worlds/ui/night` | 16 × 16 | — | to add |
| Clock: seasons | `worlds/ui/spring`, `summer`, `autumn`, `winter` | 16 × 16 | — | to add |
| Panel (inventory, dialogs) | `worlds/ui/panel` | 9-slice, 8 px corners | — | to add |

Refusal toast icons, 32 × 32, one per group of reasons (`WORLD_REFUSALS`, in the order the code lists them):

| Reason | Icon sprite key | Idea |
|---|---|---|
| `disabled` | `worlds/ui/refuse-disabled` | a closed sign (worlds are off) |
| `rate` | `worlds/ui/refuse-rate` | an hourglass (too fast) |
| `forbidden` | `worlds/ui/refuse-forbidden` | a padlock (not allowed here) |
| `far` | `worlds/ui/refuse-far` | footsteps and an arrow (too far) |
| `invalid` | `worlds/ui/refuse-invalid` | a question mark (nothing to do here) |
| `tool` | `worlds/ui/refuse-tool` | crossed tools (the wrong tool) |
| `tier` | `worlds/ui/refuse-tier` | a tool with an up arrow (too weak) |
| `energy` | `worlds/ui/refuse-energy` | an empty battery |
| `gone` | `worlds/ui/refuse-gone` | an empty tile (already done) |
| `missing` | `worlds/ui/refuse-missing` | an empty bag outline (you have none) |
| `full` | `worlds/ui/refuse-full` | a full bag (no room) |
| `cap` | `worlds/ui/refuse-cap` | a bag with a bar across it (a limit) |
| `key_taken`, `conflict` | `worlds/ui/refuse-retry` | two arrows (try again) |
| `asleep` | `worlds/ui/refuse-asleep` | zzz (asleep) |

### Seasonal overlays (REF-F, P17.37)

Season tints and palette changes are code: the base art is not repainted per season. These are the
decor and unique items a season adds. Sprite keys `worlds/seasonal/<id>`. Status: all to add (P17.37).

| Id | Season | Size | Kind | Status |
|---|---|---|---|---|
| `pumpkin` | autumn | 32 × 32 | decor, placeable | to add |
| `pumpkin_lantern` | autumn | 32 × 32 | unique item icon | to add |
| `leaf_pile` | autumn | 32 × 32 | ground decal | to add |
| `blossom` | spring | 32 × 64 | tall decor | to add |
| `sunflower` | summer | 32 × 32 | decor | to add |
| `snowman` | winter | 32 × 64 | tall decor, placeable | to add |
| `snowman_kit` | winter | 32 × 32 | unique item icon | to add |
| `snow_drift` | winter | 32 × 32 | ground decal | to add |

The 120 items of `items.json` are not listed row by row here; their icons come with the building and
crafting work (P17.24 to P17.26), each with its row.

### Farm items (P17.22, REF-E)

Shown in the hotbar and the inventory as 32 px icons; the item's name is `worlds.item.<id>`.

| Item | Kind | Icon style reference | Notes |
|---|---|---|---|
| `fertilizer_1` | fertilizer | a small sack of soil, tier 1 | speed 10 %, retention 33 % |
| `fertilizer_2` | fertilizer | the same sack with a second band | speed 25 %, retention 66 % |
| `fertilizer_3` | fertilizer | the same sack with a gold band | speed 33 %, retention 100 % |
| `shovel_1` | tool | a flat iron blade on a short handle, tier 1 | raises or lowers ground one level, energy 3 |

The building items (`wood_wall`, `wood_floor`, `torch`, `stone_stairs`, `bed`, `chest`, `fence`, `coop`, `barn`, `workbench`, `stove`) and the machine `furnace` show the sprite of their block above. Stored chest contents are never drawn in the world.

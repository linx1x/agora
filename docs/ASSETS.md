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

Not allowed: "free for personal use", "non-commercial", licenses that forbid
redistribution of the files in a repo, anything with unclear provenance, AI-
generated packs without a clear license. When unsure, leave it out and flag it.

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
or an entry uses a license outside the allowed list.

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

## Worlds: block sprites (ADR-053, P17.13)

Personal-world blocks are drawn as 32 px placeholder tiles in `apps/web/src/worlds/placeholders.ts`, from the biome palette (`art-src/palettes.json`) named in `packages/shared/data/worlds/biomes.json`. A real file for a sprite key (`worlds/<biome>/<name>`), once it is in the registry, is preferred automatically (`resolveTile`). Art for each block: 32 px wide, a top face of 24 rows and a side face of 8 rows for ground and solid blocks; decor blocks are transparent around the object. Style reference: the office palettes named below.

| Block | Layer | Sprite key | Solid | Palette |
|---|---|---|---|---|
| `stone` | ground | `worlds/shared/stone` | no | zen |
| `gravel` | ground | `worlds/shared/gravel` | no | zen |
| `sand` | ground | `worlds/shared/sand` | no | zen |
| `water` | ground | `worlds/shared/water` | no | zen |
| `meadow_grass` | ground | `worlds/meadow/grass` | no | zen |
| `meadow_dirt` | ground | `worlds/meadow/dirt` | no | zen |
| `jungle_grass` | ground | `worlds/jungle/grass` | no | jungle |
| `jungle_mud` | ground | `worlds/jungle/mud` | no | jungle |
| `desert_sand` | ground | `worlds/desert/sand` | no | oasis |
| `desert_sandstone` | ground | `worlds/desert/sandstone` | no | oasis |
| `taiga_moss` | ground | `worlds/taiga/moss` | no | boreal |
| `taiga_podzol` | ground | `worlds/taiga/podzol` | no | boreal |
| `taiga_snow` | ground | `worlds/taiga/snow` | no | boreal |
| `tilled_soil` | ground | `worlds/shared/tilled` | no | zen |
| `tall_grass` | decor | `worlds/meadow/tall_grass` | no | zen |
| `flower` | decor | `worlds/meadow/flower` | no | zen |
| `fern` | decor | `worlds/jungle/fern` | no | jungle |
| `dead_bush` | decor | `worlds/desert/dead_bush` | no | oasis |
| `oak_tree` | decor | `worlds/meadow/oak` | yes | zen |
| `jungle_tree` | decor | `worlds/jungle/tree` | yes | jungle |
| `palm` | decor | `worlds/desert/palm` | yes | oasis |
| `spruce` | decor | `worlds/taiga/spruce` | yes | boreal |
| `cactus` | decor | `worlds/desert/cactus` | yes | oasis |
| `boulder` | decor | `worlds/shared/boulder` | yes | zen |
| `wood_wall` | decor | `worlds/shared/wood_wall` | yes | zen |
| `torch` | decor | `worlds/shared/torch` | no | zen |
| `stone_stairs` | decor | `worlds/shared/stone_stairs` | no | zen |
| `wood_floor` | ground | `worlds/shared/wood_floor` | no | zen |
| `return_pad` | ground | `worlds/shared/return_pad` | no | zen |
| `bed` | decor | `worlds/shared/bed` | yes | zen |
| `shipping_bin` | decor | `worlds/shared/shipping_bin` | yes | zen |
| `shop_board` | decor | `worlds/shared/shop_board` | yes | zen |
| `chest` | decor | `worlds/shared/chest` | yes | zen |
| `fence` | decor | `worlds/shared/fence` | yes | zen |

Items for the farm (P17.22). Shown in the hotbar and the inventory as 32 px icons; the item's name is `worlds.item.<id>`.

| Item | Kind | Icon style reference | Notes |
|---|---|---|---|
| `fertilizer_1` | fertilizer | a small sack of soil, tier 1 | speed 10 %, retention 33 % |
| `fertilizer_2` | fertilizer | the same sack with a second band | speed 25 %, retention 66 % |
| `fertilizer_3` | fertilizer | the same sack with a gold band | speed 33 %, retention 100 % |
| `shovel_1` | tool | a flat iron blade on a short handle, tier 1 | raises or lowers ground one level, energy 3 |

The building items (`wood_wall`, `wood_floor`, `torch`, `stone_stairs`, `bed`, `chest`, `fence`) show the sprite of their block above. Stored chest contents are never drawn in the world.

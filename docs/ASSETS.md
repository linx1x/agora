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

*This is engineering guidance, not legal advice; your organization may want its legal team to
glance at the final registry.*

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

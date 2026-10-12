# Art direction review 08 — 2026-10-12

Revision 08 adds the four existing biomes to **Explore Agora**. See the
[biome collection](./biomes/README.md) for artwork, animal interactions and validation.

Vincent requested a complete original redraw of textures, props, items, icons,
avatars, animations and UI, retaining the 2.5D presentation and existing blocks/items.
He chose to review a working sample before the full rollout. This directory records
that sample. The older restriction against drawing new sprites in `docs/ASSETS.md`
is superseded **for this requested redraw**.

## Open and review

With the existing Vite development server running, open
<http://localhost:5173/art-review.html>. Otherwise run `pnpm dev` from the repo root.
This is a separate development entry point. Ambient animation remains review-only;
the specifically requested bed-orientation feature is also wired into personal worlds.
It needs no sign-in, media permissions, server saves or database.

- Toggle **New artwork / Current artwork** to compare both asset sets with the
  same scene placements, camera, display sizes and lighting.
- Click the scene, then use WASD or arrow keys to walk. Solid sample cells and water
  block movement. Clicking a prop selects its enlarged preview.
- Inspect all sixteen props in the gallery; preview the eight inventory icons in
  the hotbar. The hotbar is an art preview, not connected to gameplay/tool actions.
- Turn the avatar, pause animation, show the tile grid, zoom and switch day/dusk.
- **Pause wildlife** freezes wildlife, wind, water and flame flicker together;
  the avatar's Play/Pause control remains independent. Reduced motion starts both stopped.
- Scroll the inspector to **Tree growth** to switch between seedling, sapling,
  young and mature trees. The small grove keeps three juvenile ages together.
- **Bed placement** previews the vertical and horizontal bed views. In a personal
  world, select the bed in inventory and press **R** or the **Turn** button before
  placing it. The selected axis is shown on the button and saved with the cell.
- **Crop garden** switches the six sample plots between 24 crops and flowers.
  Each has five distinct visual growth stages; the sixth plot
  repeats the mature stage to show asynchronous motion. **Water crops** demonstrates
  droplets, settling foliage and damp soil. This is a cosmetic preview, independent
  of production growth timers and inventory.
- **Plants · 34** opens the searchable plant collection, with category filters,
  seed packets and harvested items. Selecting a card previews that plant in the clearing.
- **Specimen tree** selects one of ten forest/orchard trees at the back of the clearing.
  Use the four tree age buttons, and **Show blossoms / Show fruit** for mature orchard trees.

## Revision 07 — complete plant art collection

The user requested all crop art and explicitly approved adding new plant varieties.
The review now covers all 18 existing crop IDs, six new flowers, six orchard species
and the four previously approved forest trees: 34 entries, 166 growth sprites in total,
34 seed packets and 34 harvested/natural-item icons. The prior radish/kale/pea art and
forest tree artwork remain intact. Twelve new PNG atlases supply the rest.

Existing crops: dawn radish, clover bulb, meadow kale, honey pea, pearl onion,
ember pepper, river melon, gold maize, sun tomato, silk squash, amber pumpkin,
mist grape, rust yam, plum bean, reed rice, frost cabbage, snow lettuce and ice berry.
New flowers: sunflower, rose, lavender, tulip, poppy and bluebell.
New orchard trees: apple, cherry, peach, orange, pear and plum.
Existing forest trees: oak, spruce, palm and jungle tree.

All 24 field plants use five development stages, individual planting depth, the
growth-dependent soil and matching shadows. Broad leaves, flexible vines, blades,
flower heads and ordinary leaves have distinct motion profiles. Orchard trees have
three juvenile stages plus separate blossom and ripe-fruit art. Tree size, crop IDs
and root contact remain consistent with the scene. Seed/harvest hotbar previews
update to the selected field plant. Tree natural-item icons show fruit or forest seed.

Inspiration: the variety and readable stage progression in the
[Stardew crop catalogue](https://stardewvalleywiki.com/Crops) and
[flower list](https://stardewvalleywiki.com/Flowers). These are variety references;
the image generator received only Agora's approved original art as visual reference.
No Stardew artwork was copied. Final prompts are in `botanical-generation.json`,
`botanical-icons-generation.json`, and `botanical-transparency-edits.json`.
Assets are in `apps/web/public/assets/art-review/`; every final PNG is registered.

`plantAtlas.ts` and `plantItemAtlas.ts` hold measured alpha bounds and gutters.
The source PNGs are unchanged; the browser extracts sprites at runtime. Crop stages
share scale so sprouts stay small. Individual icon gutters preserve multi-piece
produce and packet edges. Seed and harvest atlases received a final built-in
transparency edit; no custom bitmap background-removal script was used.

This completes the art collection in the review, not its production gameplay rollout.
New variety IDs are local to the preview: no recipes, growth timers, shop prices,
production crop registry, translations or saves were changed. `botanical-check.mjs`
checks every extracted sprite/icon, all 24 × 5 field selections, ten tree species,
orchard blossom/fruit switching, search/filter, unique icons and mobile layout.

## Revision 06 — planted crops and growth-dependent earth

The approved crop atlas is unchanged. Crops now extend below the opaque soil surface;
radish taproots and lower bulbs are hidden while the upper shoulders remain visible.
Native soil art in `cropSoil.ts` progresses from a narrow planting slit to disturbed
clods and broken crust. A shallow uneven soil ridge grows with the plant, joining the
existing floor at every tile edge. There are no separate circular ground discs.
Crop shadows follow the soil relief and exclude buried pixels. Watering darkens both
the original furrows and the newly disturbed earth.

In **Crop garden**, **Garden growth** switches all six plots to one age or restores
the mixed-stage view. This remains a cosmetic review feature: production crop timers,
items, artwork files and save data are unchanged. Browser checks exercise all five
soil textures and ages; geometry tests check seamless plot edges and root burial.

## Revision 05 — crop artwork and motion

`apps/web/public/assets/art-review/crops.png` is an original 1619 × 971 RGBA atlas,
generated with the built-in image tool using the approved scene as style reference.
It contains fifteen silhouettes: five growth stages each for three existing crop IDs.
The exact prompt is in `crops.prompt.txt`, `generation.json` and the asset registry.
The PNG remains unchanged; runtime extraction uses measured gutters and shared scale
so sprouts stay smaller than mature plants. This covers three representative crops
in the review scene, not the full eighteen-crop production catalogue.

Radishes have leaf flutter, kale has broad-leaf rippling, and peas have slower flexible
vine sway. Each plot has a distinct phase. Motion deforms geometry above the root
collar, with both cast and contact silhouettes following the same vertices. Roots
stay fixed; there are no bobbing whole sprites or generic circle shadows.
Watering triggers a damped response, a short droplet effect and twelve seconds of
soil drying. Wildlife pause, hidden-page suspension and initial reduced-motion
preferences apply to the crop animation too. No save, farming rule or item ID changes.

Validation includes all fifteen extracted sprites, natural seedling proportions,
species selection, live motion, watering, pause and reduced motion in the browser;
unit checks cover rooted contact and matching deformed shadow projection.

## Delivered sample

- 16 original prop sprites: oak, spruce, palm, jungle tree, boulder, flowers, fern,
  cactus, chest, workbench, torch, fence, office desk, office chair, bed, shipping bin.
- 8 original icon sprites: axe, pickaxe, watering can, hoe, seed packet, radish,
  coins, backpack.
- One original character appearance with four facings and four walk frames each.
- New editable material drawings for grass, dirt, sand, wood, tilled soil and water,
  with path/shore transitions. Stone is also drawn for the display platform's edge.
- Five illustrative radish growth frames using the existing 0–4 frame convention.
- A proposed inventory bar, clock panel, colour palette and collection panel.

The source PNGs are in `apps/web/public/assets/art-review/`. `generation.json`
records the complete prompts and generator provenance. The public asset registry
contains each PNG with `Own work (AI-assisted)` metadata. OpenAI's terms page was
checked for this batch: <https://openai.com/policies/terms-of-use/>.

The reference families REF-B (props, extended to a separate character sheet in this
review) and REF-D (icons) are review drafts. The new palette and 64px prop rendering
are deliberately proposals for Vincent's approval, not an assertion that these
already conform to the old 32px/palette limits. The PNGs are retained at source size;
measured rectangles and nearest-neighbour sampling produce runtime canvas textures.

## Integration boundaries

### Wildlife, torches and bed placement (04)

`ambient.png` is an original generated sheet with bird perch/flight/peck poses,
four butterfly wing phases and four flame frames. Bird movement uses a continuous
30-second timeline: perch, fly to a second tree, perch, land, peck, hop and return.
Three birds use staggered phases. Six butterflies visit planted areas; sixteen
small insects move around the garden and water, becoming warm firefly points at
dusk. Younger trees use fence perches rather than floating birds above seedlings.
Bird feet are anchored to each pose's visible alpha baseline.

Tree and plant vertices sway gently around fixed roots. Water runs independently
of the avatar's walk animation. Torch frames share a rigid post below their flame
poses. The two torches animate at nine frames per second and drive warm falloff
on ground, props and the avatar, with stronger light at dusk and subtle flicker.
Ground halos are additive transparent effects. This is stylized local illumination,
not shadow-mapped point lights or a physical fire simulation. Updates stop while
the document is hidden; reduced motion starts with the ambient timeline paused.

`beds.png` supplies two genuinely different axis-aligned views, replacing the
diagonal review sprite. The same loader now fills the personal-world atlas's two
bed entries. Holding the existing `bed` item exposes a Turn button and R shortcut.
The request, action queue (including resend), protocol, server placement rule,
chunk JSON and terrain reader preserve optional `bedAxis` metadata. Legacy beds
default to vertical. Removal returns the same bed item; placing again explicitly
writes the current axis. Collision and the one-cell gameplay footprint stay the
same. This is the only production art/placement integration in this revision.

The built-in image generator created both source sheets; their exact prompts are
saved in `generation.json`, with corresponding public registry entries. Runtime
cropping/registration leaves the source PNGs intact. Bird transitions, placement,
JSON round-trip, reconnect resend, geometry selection and HUD labels are tested.
The server integration test reopens a world containing a horizontal bed, then
removes and replaces it vertically. It passes on the memory backend; Postgres
variants require `TEST_DATABASE_URL` and are skipped when it is absent.

### Scale and habitat revision (03)

Mature oak/spruce/palm/jungle cards are now 4.3–4.8 world units tall, compared
with the avatar's 1.4. Desk display size is 2 × 1.65, bed 1.85 × 1.85 and
workbench 1.85 × 1.4. These dimensions include transparent canvas space. The
review arrangement and deck were expanded to accommodate the larger furniture;
production item definitions and collision footprints remain unchanged.

`tree-growth.png` is a new original atlas made with the built-in image generator,
using the approved prop atlas as a style reference. It contains three different
juvenile silhouettes for each of four species; mature art comes from `props.png`.
The 1448 × 1086 source remains intact, with measured runtime crops. Tree texture
resolution increased to 128 pixels for mature art and 96 for juvenile art. Full
prompt and provenance are in `generation.json` and the public asset registry.
These are manual review controls, not a newly implemented gameplay growth timer.

The editable terrain now uses broad colour fields across tile boundaries,
root/stone earth patches, rough path edges, broken furrows and escaped weeds.
Grass and bank reeds use two instanced draws, clustered around props and shores.
The background continues into a muted woodland edge. Furniture and existing
props retain the approved artwork.

The pond is recessed: its bed slopes from -0.17 to -0.59 world units, with colour
changing from shallow green to deeper blue. Transparent glints sit at -0.085,
above submerged stones. Vertical banks and uneven wet shelves connect it to the
land. The background ground is a ring so it cannot cover the pond bed. This is
stylized depth and surface animation, not a fluid/refraction simulation.

Browser verification covers all four age controls, four growth preview images,
four species, recessed surface height, existing GPU occlusion, comparison modes,
movement, animation, gallery, mobile layout and reduced motion. Screenshots of
every age are under `test-results/art-review/growth-0.png` through `growth-3.png`.

### Grounding revision

The preview now derives cast shadows from the actual alpha silhouette of each prop,
crop and avatar frame. All shadows project away from the same upper-left light;
there are no circular blob shadows. Near-ground occlusion fades rapidly above the
supports and expands only one texture pixel around the contact edge.

The last visible sprite row anchors the object to the floor, rather than the bottom
of its transparent canvas. The painted footprint folds onto the ground using the
fixed 35-degree camera projection: roots, rear furniture feet and shoes occupy floor
depth, while upper artwork stays upright. This changes preview rendering only;
source artwork, item definitions, cell footprints and collision rules are unchanged.
Three projection/contact regression tests live in `src/artReview/grounding.test.ts`.

### Paper Mario placement revision

The approved pixel artwork remains the visual foundation. The hybrid direction
borrows TTYD's separation of world-space cutouts, solid environment geometry and
blended effects. Solid prop/avatar pixels now use alpha cutoff 0.5, depth testing
and depth writes, with blending disabled. Empty pixels cannot erase scenery or
push a whole sprite into the transparent sorting queue. Shadows remain blended
with depth writes disabled. The camera remains the game's fixed 35-degree view.

The floor clearance is now 0.004 tiles, with the cast/contact layers at 0.001/0.002.
Subtle vertex shading darkens the lowest 0.18 tiles of each sprite and fades with
height. Contact and cast opacity were strengthened without adding circular blobs.
These are Agora design choices, not recovered TTYD constants or shadow algorithms.
The footprint fold from the previous revision is likewise an Agora adaptation.

The browser check renders actual chest, desk and tree geometry/alpha maps into a
GPU target. It deliberately draws the avatar last, then checks that no avatar
pixels cover an opaque prop when behind, and that the avatar does cover it when
in front. Screenshots also show the avatar on both sides of the chest. The
review-only `window.__artReview.pose(x, z)` hook makes those poses repeatable.

`src/artReview/catalog.ts` maps the props to existing world IDs and office tile
names. The sample occupies one existing cell per placed item. Item catalogues,
collision definitions and crafting recipes remain unchanged. Revision 04 adds
optional bed orientation to stored cells and the production bed atlas/placement
path, as detailed above. The preview imports the game's 35-degree perspective-camera math and
renders upright cards in Three.js.

This is an **art review scene**, not a screenshot of the live world renderer.
Its display-only tree heights and furniture cards show the proposed art clearly;
the live renderer's mesh/extrusion rules still require integration after approval.
Both sides of the comparison use those same display dimensions. Current artwork is
loaded from the real placeholder functions, office sheets and paper-avatar code.
The surrounding review interface stays the same when the artwork toggle changes.

The new avatar is one visual specimen. Saved skin/hair/clothing/accessory variants,
seated/crouched poses, NPCs, pets, tool swings, all crops, seasons, the other biome
materials, wall/roof tiles and the rest of the UI are **still pending the approved
direction**. The sample does not claim to replace the entire game's art.

## Reference research

- User-supplied REA: <https://github.com/morluto/rea>. The first art sample used
  reference research only. For revision 02, the `reverse-engineer-anything` skill
  was installed and read, and REA CLI 6.4.0 was invoked through npm.
- Official visual reference: <https://www.stardewvalley.net/press/>.
- Local installation found at
  `C:\Program Files (x86)\Steam\steamapps\common\Stardew Valley`.
  The Content catalogue and XNB headers for the farmer, crop and craftable sheets
  were inspected. They are compressed XNB content. No game files were changed,
  unpacked, copied into Agora or sent to the image generator.
- Quality targets inferred from the reference: readable silhouettes, deliberate
  pixel clusters, controlled material ramps, warm highlights and shared visual
  density between people, world and inventory.

### TTYD evidence and limits

The supplied European RVZ is 334,486,412 bytes. Its header identifies RVZ and
contains the disc ID `G8MP01`. REA `inspect-artifact` rejected it with
`target_unavailable`, reason `unsupported binary format`. REA doctor also found
no configured analysis engine. The CLI response is retained in ignored scratch
at `test-results/paper-mario-research/rea-rvz.json`. No executable was extracted,
decompiled or run; the supplied file was not modified. Installing the skill alone
does not install analysis engines or register MCP tools.

Public reconstruction evidence used for the revision:

- [TT YD icon driver](https://github.com/doldecomp/ttyd/blob/main/src/driver/icondrv.c#L282-L293):
  world translation and camera-yaw billboard orientation; its world icons use a
  3D display queue separately from HUD icons. This supports world placement,
  but does not establish how every furniture model in the game is built.
- [Display driver](https://github.com/doldecomp/ttyd/blob/main/src/driver/dispdrv.c#L102-L157):
  the cutout mode disables blending and writes depth; blended modes test depth
  without writing it. This is the direct reference for the material change.
- [Noclip TTYD world parser](https://github.com/magcius/noclip.website/blob/main/src/PaperMarioTTYD/world.ts#L655-L706):
  transformed environment nodes and indexed geometry support the broader 2.5D
  staging direction. We have not rebuilt the sample furniture as full 3D models.
- [Shadow driver](https://github.com/doldecomp/ttyd/blob/main/src/driver/shadowdrv.c):
  incomplete reconstruction; it does not establish the original shadow algorithm.
- [Dolphin RVZ specification](https://github.com/dolphin-emu/dolphin/blob/master/docs/WiaAndRvz.md):
  container reference only, not evidence about scene rendering.

These public reconstructions were not verified against the supplied European
binary. The preview adapts the supported rendering principles; it is not an exact
recreation of either game's engine or graphics. No Nintendo or Stardew artwork
was copied into the project. Full catalogue rollout still follows sample review.

## Audit and validation

The personal-world catalogue currently contains 46 blocks, 132 items, 18 crops and
16 tool definitions. The office art additionally has common, hub, jungle, oasis,
boreal, zen and pet sheets, plus procedural avatar/decor and interface glyphs.

Run `node scripts/art/review-check.mjs` while the dev server runs. It uses installed
Edge by default (`ART_REVIEW_BROWSER=chrome` selects Chrome) and verifies asset
loading, comparison modes, movement, four animation frames, gallery, inventory
selection, GPU front/behind occlusion, dusk, mobile overflow and reduced motion. Screenshots are written to
`test-results/art-review/`. Also run the web typecheck, scoped lint and
`pnpm assets:check`.

Next checkpoint: Vincent's feedback on the actual scene and avatar. After approval,
implement proper production loaders and compatible avatar layers, then replace the
remaining catalogue in biome/material batches and verify in the live game.
# Revision 08 — existing biome collection

The existing meadow, jungle, desert and taiga now have dedicated review scenes.
Use **Explore Agora** in the art preview. The approved Studio remains available.
See [biome collection notes](./biomes/README.md) for the 13 animal types,
18 new environment sprites, interaction previews, generation prompts and evidence.
These new scenes remain review-only pending feedback; production rollout is separate.


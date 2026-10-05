# Spike P9.8: blended tiles from formulas

Time-boxed spike for ADR-037 (proposed). It doesn't change any app code. The page draws
the same 16×10 jungle map twice: once with today's one-tile-per-cell art, once with every
pixel computed from the cell's neighbours. You can paint on the blended map to try the
build-mode preview.

## Run it

From the repo root:

```sh
python -m http.server 8000      # or: pnpm dlx serve .
# open http://localhost:8000/spikes/blend/
```

The page loads `apps/web/public/assets/agora/{jungle,common}.png/json` and
`art-src/palettes.json` straight from the repo. It uses no new art, so `registry.json` and
Credits don't change.

| File | What it is |
|---|---|
| `blend.js` | The renderer. Pure: grid in, pixels out. No caching, no DOM. |
| `app.js` | The page: loads the art, draws "today", palette, hover preview, measurements. |
| `page.html` | Markup and styles. `build.py` wraps it into `index.html` (and a self-contained `artifact.html`). |
| `screenshots/` | Today vs blended, the build preview, the smin bulge finding. |

## What it does

**Ground (formula 1).** For each pixel `p`:
`score_t = w_t(p) + 0.5·(noise_t(p) − ½) + 0.28·(height_t(p) − ½)`.
`w_t` is the weight of terrain `t` over the 4 nearest cell centres, smoothstepped so blobs
keep the cell's shape. `height_t` is the texture's own luminance, so grass pokes into dirt
along its blades. The pixel takes the texture of the best score, sampled in world space.
A one-pixel rim marks where grass meets dirt: shadow on the dirt, bright tips on the grass.
Grass and flowers have no rim; they just mix.

**Objects (formula 2).** Each object cell becomes a core box plus a connector box towards
each joined neighbour. The connector overlaps the shared edge by 8 px on both sides, over
the rows both cells cover. `d = min` over all boxes gives one shape with no inner edges.

- **Top face:** `d < 0`.
- **Front face:** the top swept down 10 px (lip, apron, then legs where the shape ends left or right).
- **Shading:** `dot(∇d, light)` within 3.5 px of the edge, plus planks and grain in world space.
  Planks run along the arm, so an L turns its grain at the corner.
- **Outline:** only on the outer edge.
- **Seam:** one dark pixel line only where the material changes, desk to counter, placed on the cell edge.

**Stacking.** A prop rests on the top face of its cell. Its base row comes from the
sprite's alpha. It casts a contact shadow one ramp step darker. A lamp also adds a warm
pool to the surface it stands on. A prop with no surface under it is refused, which is the
`planEdit` rule P9.11 would add.

**Palette.** Shading is a continuous level that snaps to the jungle ramp (`wood0–4`,
`stone0–3` + `pebble`) through a 4×4 Bayer threshold. Untick "Snap to jungle palette" to
compare with smooth interpolation.

## Results (headless Chromium, cloud VM, no GPU, unoptimised JS)

| Check | Result |
|---|---|
| Whole map, 160 cells | 165–230 ms, about 1.0–1.4 ms per cell |
| 3×3 build preview | 5–6.5 ms average, 15–23 ms worst (160 previews, mixed tools) |
| Same input → same pixels | Identical hash for: whole map, whole map again, and the map stitched from 160 one-cell renders |
| Preview equals applied result | 13 / 13 scripted edits (mouse and keyboard) |
| An edit only changes its 3×3 | 13 / 13 (full-map pixel diff after each edit) |

The one-cell stitch matching the whole map shows the renderer is purely local. Any region
can be drawn on its own and still match, which is what the variant atlas in P9.10 and the
scratch-canvas preview in P9.12 rely on.

## Findings

1. **Smooth-min is wrong for furniture.** With `k > 0`, smin bulges the shape by 1–2 px
   wherever two parts overlap, so every joint dipped. The leg test then saw a "new end" at
   each bump: legs every ~16 px (`screenshots/smin-bulge-legs.png`). It also made odd
   wedges at inner corners. Furniture uses exact union (`k = 0`). Keep smin for organic
   families (hedges, ponds, rocks), where the bulge is the look you want.
2. **One box per cell isn't enough.** A cell joined downward used to widen its box
   sideways too, so a T-junction stuck out past the desk under it. Core box plus
   per-side connectors (over the rows both cells share) fixed it. P9.9 should define join
   geometry this way.
3. **Choose material by the cell, not by the nearest field.** Where two materials overlap,
   their distances tie across a wide band, which drew a bow-tie seam. Taking the
   material from the cell under the pixel gives a one-pixel seam on the cell edge.
4. **Ground blends read well at room scale.** Single-cell protrusions come out as rounded
   mounds rather than squares. The hand-drawn `path0–15` tiles keep a neater edge, so a
   designed path may still want them. Free painting doesn't.
5. **The palette snap matters.** Without it the desk tops go soft and airbrushed and stop
   matching the hand-drawn props sitting on them.
6. **Speed is fine for lazy CPU composition.** About 1 ms per cell unoptimised means a
   full HQ map (~5,000 cells) composes in about 5 s cold. That cost has to be hidden:
   compose only on-screen cells first, cache in the variant atlas, or move the formula to
   a worker. A 3×3 preview at ~6 ms is well inside one frame budget at hover rate. No
   GPU shader is needed for v1.
7. **Not covered.** Walls, windows and animated water. Today's art for wall-like objects
   (`bookshelf`, `sofaL/M/R`) would need its join pieces redrawn as materials instead of
   whole sprites. A props layer needs y-sorting with avatars in the real scene (P9.11).

## Decision needed (HUMAN CHECKPOINT D)

Do the blended desks, counters and ground look right for Agora? If yes, ADR-037 becomes
accepted with findings 1–3 folded in and P9.9 starts. If the look is close but off, say
what is off and I'll adjust ramps and shading before moving on.

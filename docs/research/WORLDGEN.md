# World generation research for Agora worlds (P17.17)

Status: research note for stream C. Public sources only (section 1). We write our own noise and rules; no code,
tables or art are copied. The numbers are starting values for P17.4, P17.5 and P17.32. They must be calibrated
with the P17.12 panel and the tests in section 10.

Plan reference: the P17.17 text names P17.30 for caves. In PLAN, caves are P17.32 (P17.30 is the marketplace).
This note uses P17.32.

## 1. Sources and what we took

- Red Blob Games, "Making maps with noise functions" (redblobgames.com/maps/terrain-from-noise/, read 2026-10-10
  as a fetched summary). Taken: octave sum with doubling frequency and halving amplitude; division by the amplitude
  sum; separate seeds for moisture; a two-variable biome table (elevation x moisture). Not taken: its thresholds,
  which the article itself says must be tuned per generator.
- Amit Patel, "Polygon map generation" (Stanford, 2010; amitp/game-programming, fetched summary). Taken: rivers from
  high points following the steepest descent; flow summed downstream; river width from the square root of the flow;
  lakes as water not connected to the border; moisture falls with distance to water. Not taken: Voronoi polygons
  (our grid is square cells).
- Red Blob Games, "Polygon map generation" (mapgen2 article, summary only). Used to confirm direction. Its remarks on
  evaporation and wind (mapgen4) are future work, not in v1.
- RogueBasin, "Cellular Automata Method for Generating Random Cave-Like Levels" (fetched summary). Taken: wall fill of
  about 40%; the 4-5 neighbour rule; a wider 5x5 pass to open large areas; 4 + 3 passes; a blank strip through the
  middle; flood fill and a minimum open share of about 45%.
- Minecraft Wiki, "World generation" (Java Edition, 1.18 and later; fetched summary). Taken: climate values
  (temperature, humidity) choose biomes as intervals in a multi-parameter space; altitude changes the climate; caves
  come from 3D density. Not taken: splines and 3D density (they do not fit a stepped 2.5D level model). Our chunks
  are 32 x 32, not Minecraft's 16 x 16.
- Barnes, Lehman, Mulla (2014), "Priority-Flood": depression filling for river routing. Cited from the paper's known
  method; not fetched in this session.

## 2. Pipeline and determinism rules

Per chunk (32 x 32 cells, 32 px per cell), in this order:
1. Elevation E (fBm) -> E' -> integer level L 0..7, sea and beaches.
2. Temperature T and humidity H (fBm), adjusted by altitude and nearby water.
3. Biome weights from four centres in (T', H'); a dithered choice per cell.
4. Rivers from the region cache (section 6): carve levels, add water.
5. Surface block, beaches, decor from hashes.
6. Output per cell: `level`, `block`, `decor` (three Uint8 arrays, 3 KB per chunk).

Rules that keep client and server identical (the server runs the same code to validate):
- Only `+ - * /`, comparisons, `Math.floor`, and integer ops (`Math.imul`, `>>>`, `^`) in generation. No
  `Math.sin`, `cos`, `pow`, `exp`, `log`, `atan2`, and no `Math.sqrt`: the ECMAScript spec allows engines to round
  these differently, so compare squared distances instead.
- Thresholds that must be exact compare integers: `Math.floor(x * 65536)`.
- Every value is a function of world cell coordinates `(x, y)` and the seed. A chunk reads only pure functions over
  a halo (no neighbour output), so chunks join without seams.
- Hashes: 32-bit integer mixing keyed by `(seed, salt, x, y)`. One salt per layer (elevation, temperature, humidity,
  decor, sources, trees).
- Golden tests: fixed cells per seed compared to stored values (P17.1 and P17.4).

## 3. Noise

- 2D simplex noise, fBm: `sum(a_k * n(f_k * p))` with octave k, `f_k = f * 2^k`, `a_k = 0.5^k`, divided by the sum of
  `a_k`. The result is in about [-1, 1]; map it to [0, 1] with `u = (n + 1) / 2`.
- Feature size (cells) = 1 / f. Starting values:
  - elevation: 5 octaves, feature 160 cells (about 5 chunks);
  - temperature: 3 octaves, feature 256 cells;
  - humidity: 4 octaves, feature 200 cells.
- Each layer uses its own salt, so the three fields are independent.

## 4. Height, levels and sea

- `E' = clamp(2 * (u - 0.5) + 0.5, 0, 0.999)`. A contrast of 2 spreads the middle of the distribution over more of
  [0, 1]. Starting value; calibrate.
- Level `L = floor(E' * 8)`, values 0..7.
- Sea level 2: cells with `L < 2` are ocean floor, filled with water up to level 2. Land at level 2 next to water is
  beach (sand).
- Mountains are levels 6 and 7. Taiga shows snow from level 6.
- Redistribution: an optional `E'^2` (computed as `e * e`) deepens valleys. Off by default.
- Targets: 20-30% of cells are water and about 15-25% are level 6 or higher, over 64 seeds of 16 x 16 chunks.
- Walking rule (P17.6): neighbours may differ by at most one level (`|dL| <= 1`).

## 5. Climate and biome blend

- Temperature `T = u_T`; altitude lowers it: `T' = T - 0.06 * max(0, L - 3)` (level 7 gives -0.24).
- Humidity `H = u_H`; `+0.10` if ocean or river is within 4 cells (a pure check inside a 4-cell halo).
- Four centres in `(T', H')`:

| Biome | T | H | Surface | Decor per cell, before the 5 x 5 thinning |
|---|---|---|---|---|
| Meadow | 0.50 | 0.50 | grass | flowers 0.05, bushes 0.01, trees 0.03 |
| Jungle | 0.85 | 0.85 | jungle grass | trees 0.12, vines 0.04, flowers 0.02 |
| Desert | 0.85 | 0.15 | sand | cacti 0.008, rocks 0.02 |
| Taiga | 0.15 | 0.60 | grass; snow at level 6+ | conifers 0.08, rocks 0.03 |

- Weight: `w_i = max(0, 1 - d_i / R)^2`, with `d_i = |dT| + |dH|` (L1 distance, no sqrt) and `R = 0.6`.
  Centres closer than 2R overlap, so borders blend. If all four weights are 0, use the nearest centre.
- Pick the top two weights `w1 >= w2`: `t = (w1 - w2) / (w1 + w2)` (0 if the sum is 0). The cell takes biome 1 if
  `t > B(x, y)`, else biome 2. `B` is a 4 x 4 Bayer threshold `(v + 0.5) / 16`, so the border is a dither pattern and
  not a straight cut.
- Shares: each biome 15-35% of land in a 1024 x 1024 sample (calibrate).

## 6. Rivers (P17.5)

- Routing uses the float `E'` (not the level), so the flow has no flat steps. Ties break by cell index.
- Region: core 8 x 8 chunks (256 x 256 cells) plus a halo of 64 cells, window 384 x 384. Cached per region id; keep
  about 16 regions in an LRU.
- Sources: a cell with `E' >= 0.72` that is the maximum of `E'` in its 9 x 9 window, and whose hash is below 1/32.
  Expect 1-6 per region (measure).
- Depressions: priority-flood fill of `E'` (Barnes et al.). A cell whose filled height is above its own is a lake
  cell at the filled height. Ignore lakes shallower than 0.02.
- Flow: each non-lake cell points to its lowest of 8 neighbours. Diagonal slope is multiplied by 0.7071 (a constant,
  no sqrt). Ties in a fixed order.
- Accumulation: visit cells from high to low `E'` and add each count to the downstream cell (Patel's summed flow).
- River cell: `acc >= 48` and not ocean. Width from `acc`: 1 cell for 48-159, 2 for 160-399, 3 for 400 and up,
  centred on the flow line.
- Ends: at ocean (`L < 2`) or at a lake cell (lake cells become water).
- Carving: river cells get `level = max(2, L - 1)` and block water. Water is not walkable; bridges come later.
- Seams: a cell's river status comes from the region whose core contains it. Heights in the halo are pure, so the
  flow crosses a seam the same way from both sides. Accumulation near the halo edge is an undercount (upstream is
  outside the window), so a river can look like it starts up to 30-60 cells inside the seam. Test in section 10.
- Cost (not measured): about 30-80 ms per region in V8 for 147k cells. Measure in P17.5; if it is over 150 ms, cut
  the halo to 32 cells and accept more seam error.

## 7. Chunks, seeds and decor

- Chunk: 32 x 32 cells; key `(cx, cy)`; world range +/- 2^20 cells (+/- 32768 chunks).
- Cell randomness uses `hash(seed, salt, x, y)` in world coordinates. Chunk-level choices use `hash(seed, cx, cy)`.
- Halos: 4 cells for humidity and beaches; 64 cells for rivers (cached per region).
- Trees: candidate if `hash < density(biome)` and its hash is the maximum in the 5 x 5 window around it (pure, halo 2).
  Trees are at least 3 cells apart without a per-chunk list.
- Snow: a Taiga cell at level 6 or higher. Cave mouths (P17.32): a rare hashed decor at level 6 or higher in mountain
  cells, density 1/400 (placement only; the cave is a separate map).
- Spawn: the starter stamp (P17.10) flattens a radius of 12 cells around (0, 0) to level 3 before biomes. The flatten
  is part of the generator, so it is a parameter and changes with `genVersion`.
- Cache: 512 chunks (about 1.5 MB at 3 KB each).

## 8. Starting parameters for `worldgen.json` (P17.4)

| Key | Value | Notes |
|---|---|---|
| `genVersion` | 1 | Bump on any code or parameter change. |
| `elevation.octaves` / `featureCells` | 5 / 160 | |
| `elevation.contrast` | 2.0 | Calibrate for 20-30% water. |
| `levels` / `seaLevel` | 8 / 2 | Levels 0-7; below 2 is water. |
| `temperature.octaves` / `featureCells` / `lapse` | 3 / 256 / 0.06 | Per level above 3. |
| `humidity.octaves` / `featureCells` / `waterBonus` | 4 / 200 / 0.10 | Within 4 cells. |
| `biome.radius` | 0.6 | L1 distance in (T, H). |
| `biome.centres` | Meadow 0.50/0.50, Jungle 0.85/0.85, Desert 0.85/0.15, Taiga 0.15/0.60 | Section 5. |
| `rivers.coreChunks` / `haloCells` | 8 / 64 | Section 6. |
| `rivers.sourceMinE` / `sourceWindow` / `sourceChance` | 0.72 / 9 / 1/32 | |
| `rivers.minFlow` / `widthSteps` | 48 / [160, 400] | Widths 1, 2, 3. |
| `caves.size` / `fill` / `wideRulePasses` / `basicPasses` / `minOpen` | 128 / 0.40 / 4 / 3 / 0.45 | Section 9. |
| `trees.window` | 5 | Section 7. |
| `spawn.flattenRadius` / `spawn.level` | 12 / 3 | |

Rules for the file: zod schema with ranges; the panel (P17.12) changes values in memory; a saved world keeps a copy of
the parameters it was created with (sent as `world:welcome.params`), so an edit to the file cannot change an
existing world.

## 9. Caves (P17.32, separate maps)

- One map per cave mouth: 128 x 128 cells, seeded by `hash(seed, caveId)`. Each cell is wall or open.
- Fill 40% walls. Blank a strip 3 cells tall through the middle (stops long vertical walls).
- Four passes of the wide rule: wall if at least 5 of the 3 x 3 cells are walls, or at most 2 of the 5 x 5 cells are
  walls. Then three passes of the 3 x 3 rule only (4-5 rule).
- Flood fill from a random open cell; keep the largest open region. If it is under 45% of the map, try the next salt
  (at most 8 tries, then accept the largest).
- Depth = rows below the mouth; depth picks the ore table (P17.18 data). The return portal is at the mouth.
- No biomes or rivers inside a cave. Tunnels in 3D are out of scope (the stepped-level model has no overhangs).

## 10. Tests for P17.4, P17.5 and P17.32

- Golden: fixed cells per seed match stored levels, blocks and decor; same output on two runs.
- Borders: `chunk(0, 0)` column 31 equals the value computed from a window centred on that cell (halo proves no seam).
- Water 20-30% and level 6+ 15-25% over 64 seeds; biome shares 15-35% over a 1024 x 1024 sample.
- Speed: `generateChunk` under 5 ms with a warm region cache (P17.4 test). The region build is timed separately
  and reported.
- Rivers: every river cell reaches ocean or a lake by following the flow (no loops); rivers with `acc >= 96` continue
  across a region seam for 50 seeds, with at most 3 cells of mismatch.
- Caves: at least 45% open after the fill; one connected open region; same map for the same `(seed, caveId)`.

## 11. Open items and risks

1. Calibration: `elevation.contrast` and the level shares need samples over many seeds (P17.4 test, panel P17.12).
2. River seams: the undercount near the halo edge may show as a river that starts inside a region. Accept or raise
   the halo, based on the seam test.
3. Dithering look: check in the 2D view at checkpoint L; the band width may need a different `radius`.
4. Browser determinism: tests run in Node only. Add one golden check in the browser e2e (P17.14).
5. Playability: spawn is always flattened (section 7), but a world with no land within 60 cells would still be
   possible; calibration should make that rare.
6. Model width: Minecraft uses six climate parameters. We use two (T, H) plus altitude, which is enough for four
   biomes. Continentalness and erosion are not needed in v1.

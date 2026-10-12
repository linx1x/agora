# Production world art integration

The approved biome collection is connected to the personal-world renderer,
`apps/web/src/worlds/view3d/WorldRoom3DView.ts`. The separate art-review page
remains available for comparing the artwork and reviewing future additions.

Existing worlds retain their generated terrain, block IDs, chunk deltas, crop
states and farm animals. Rendering uses the existing cells; larger trees and
furniture do not silently enlarge their gameplay collision footprints. Ambient
wildlife is a visual layer rather than newly persisted livestock or inventory.

## Production browser check

`e2e/world-art.spec.ts` opens the normal application and signs in through the
development login. It replays server-shaped messages through the real client
receive handler to create a temporary fixture in the actual personal-world
renderer. It does not mount the review scene or write to a player's saved world.

Coverage includes:

- Meadow, jungle, desert and taiga terrain, trees, understory and water.
- Beds in both orientations, workbench, torch, coop and barn.
- The four existing livestock kinds and all 18 existing crop IDs, each with
  five rendered stages.
- Approved asset loading, atlas readiness, shadows and ambient wildlife.
- Original collision rules and real pointer-to-world navigation.
- A 390-pixel phone viewport, reduced motion and browser/GPU errors.

Build first with `pnpm build`, then run:

```sh
node scripts/art/world-integration-check.mjs
```

The standalone runner uses an isolated in-memory server on port 3323 and runs
the same assertions as the Playwright spec. It sets `NODE_ENV=test` and clears
`DATABASE_URL`; local `.env` loading is skipped, so this check does not read or
migrate a local save. It defaults to the installed Windows Edge executable;
set `PW_CHROMIUM` to another installed Chromium executable if necessary.

The usual test runner remains supported with `pnpm exec playwright test
--config e2e/world-art.config.ts`. This focused config omits optional voice and
passkey servers, and `E2E_PORT_OFFSET` shifts its port. On the current Windows
host, the Playwright test loader stalled before launching a test; the standalone
runner bypassed that loader and completed the production assertions.

The standalone runner retains screenshots and JSON diagnostics in
`art-src/review/biomes/production/`. Their fixture is deliberately deterministic
so the same objects can be inspected across all four habitats. The broad flat
clearing and straight pond bank belong to the test fixture, not world generation.

## Observed result — 2026-10-12

The production check passed on the final build, including actual pointer walking
to a cell beyond the existing empty-hand harvesting range. It loaded the approved
2048 × 4096 atlas, rendered ambient wildlife and contact/cast shadows, and reported
no browser or GPU errors. Desktop screenshots for all four habitats and the
390-pixel phone screenshot were inspected. The phone layout fits without horizontal
overflow and keeps the player, scene and controls visible. Scoped ESLint passed.

Retained evidence: `world-art-meadow.png`, `world-art-jungle.png`,
`world-art-desert.png`, `world-art-taiga.png`, `world-art-mobile.png`, and the
matching biome JSON snapshots in the `production` directory.

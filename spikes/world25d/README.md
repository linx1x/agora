# Spike: the Jungle in 2.5D (P16.1, P16.2, ADR-052)

Time-boxed spike, not part of the app. It reuses the app's tile art (`apps/web/src/game/tiles.ts`,
`sprites.ts`, `avatars.ts`) and the shared map code, and shows the Jungle wing of `hq.tmj` in a fixed,
tilted perspective view (camera looks north, no rotation).

```
cd spikes/world25d
npm install
npm run dev            # http://localhost:5190 (menu)
npm run bench          # headless benchmark matrix → results/headless-swiftshader.json
node stills.mjs        # art stills → stills/*.png (the WebP copies are committed)
npx vitest run --config spikes/world25d/vitest.config.ts   # from the repo root
```

| File | What it does |
| --- | --- |
| `src/scene.ts` | Map region → textured 3D faces (first draft of P16.4's rules) |
| `src/camera.ts` | Fixed-tilt perspective maths, click-to-floor, the card flip curve |
| `src/three-main.ts` | Variant (a): Three.js, one merged mesh, real-time lights, optional sun shadows |
| `src/phaser-main.ts` | Variant (b): Phaser 4.2.1 projecting the same faces on the CPU into `Mesh2D` |
| `src/sim.ts`, `src/hud.ts` | Bots on the shared A*, settings panel, stats, nameplates, benchmark |
| `src/paper-avatar.ts` | The new paper cut-out avatar (pixel and smooth looks, two sizes) |
| `src/styles.ts`, `src/stills-main.ts` | Storybook redraw, low-poly models, the stills |

Results are in the ADR-052 addendum. The real-device numbers come from the "Agora 2.5D Benchmark"
artifact (the same pages, built with `PAGE=three SINGLE=1 npm run build` and
`PAGE=phaser OUT=dist-split npm run build`).

# Jungle biome art pack

Original Agora art, generated with the built-in image generation tool on 2026-10-12. The approved Agora props atlas was the only image reference. Final images are saved in `apps/web/public/assets/art-review/biomes/`.

## Assets and integration

- `jungle-props.png`: 1536 × 1024 RGBA, six isolated props: broad jungle tree, fern, banana understory, mossy boulder, fallen log, bromeliad.
- `jungle-animals.png`: 1536 × 1024 RGBA, three animals × four poses: idle, walk A, walk B, feeding.
- `apps/web/src/artReview/biomes/jungle.json`: measured atlas rectangles, world dimensions, environmental colors and behavior hints.
- Both images have real transparency. Alpha threshold 100 measurement finds exactly six large prop components and twelve large animal components. The first props layout was regenerated through an image edit to ensure neighboring sprites do not intrude into source rectangles.
- Animal frame rectangles preserve row-wide sizes and a common ground baseline so the feeding frame remains the same scale as idle.
- Tree must be large in scene; use bottom-center anchoring and terrain contact shadow. No cast shadow is baked into source art.
- Wildlife art and suggested behavior only; parent task owns scene interactions.

## Inspiration

Minecraft's official [Around the Block: Jungle](https://www.minecraft.net/en-us/article/around-block--jungle) provides biome identity: lush dense trees, trailing vegetation and bamboo. The official [parrot spawn rule](https://learn.microsoft.com/en-us/minecraft/creator/reference/source/vanillabehaviorpack_snippets/spawn_rules/parrot?view=minecraft-bedrock-stable) associates parrots with jungle biomes. These informed species and density, while all imagery uses Agora's existing original pixel-cluster look. Capybara, turtle, banana and bromeliad are original additions to this jungle visual pass, not claims about Minecraft's item catalog. No game art was extracted or copied.

## Exact prompts

### Props generation

Use case: stylized-concept.
Asset type: original Agora jungle environment sprite atlas, transparent RGBA, landscape 3 columns by 2 rows exactly six isolated objects.
Reference image role: style reference only; match its warm hand-crafted pixel clusters, dark green shaded silhouettes, upper-left light and cozy 2.5D view slightly above front. Create new original art. 
Sheet layout: top row left giant broad jungle tree with buttress roots, dense tiered jade canopy and hanging vines; top middle broad fern clump; top right banana understory plant with broad leaves and small bunch of green bananas.
Bottom row left mossy granite boulder; bottom middle fallen moss-covered jungle log with a dark end hollow; bottom right three vivid coral bromeliad flowers with broad green basal leaves.
Every sprite entirely within its own equal cell, generous transparent gutters at least 40 px and outside padding. Tree must retain large canopy and roots; other objects may fill their own cells, runtime gives natural relative sizes. Objects centered bottom on row baseline. Genuinely transparent background, no labels, no grid, no outlines in white, no border, no ground plane or platform, no baked cast shadows; roots and vegetation emerge directly from base. Richly detailed crisp pixel-cluster 2.5D game art, subtle irregular natural forms, coherent warm greens and damp woodland color. Match reference shading and pixel density, no smooth vector art, no photorealism.

### Props spacing edit

Use case: precise-object-edit. Edit this original jungle sprite atlas ONLY to improve the grid layout and isolation. Preserve all six object designs, pixel art style, colors, pixel details and true transparency. Arrange the six objects in a strict 3 column x 2 row equal cell grid on a 1536x1024 transparent canvas. Every cell is 512 by 512 pixels. Shrink the giant tree to fit wholly in its top-left 512x512 cell with at least 32 pixel clear margins on ALL four sides; it may be smaller than before. Put fern wholly inside top-middle cell, banana wholly inside top-right cell, boulder bottom-left, log bottom-middle, flowers bottom-right. Resize each object as necessary so no sprite extends beyond its cell and at least 64 pixels transparent space separates neighboring sprites. Keep all bases inside own cells. No shadows, no text, no visible grid, no new elements, no background. This is a technical sprite atlas with isolated, separated sprites.

### Animal generation

Use case: stylized-concept. Asset type: original Agora jungle animal animation sprite atlas, transparent RGBA.
Reference role: only stylistic guidance for crisp textured pixel clusters, warm light upper-left and cozy 2.5D rendering viewed slightly above front/side. Draw original animals.
Layout: exact regular 4 columns by 3 rows; 12 separate sprites with wide transparent gutters, every sprite contained in its cell.
Row 1: a small red, blue and gold tropical parrot, facing right. Columns idle standing; stepping forward A left foot down; stepping B right foot down; pecking down.
Row 2: a friendly warm brown capybara, facing right. Columns idle standing; walking A; walking B with alternate feet; grazing head lowered.
Row 3: a tiny green turtle with textured olive shell, facing right. Columns idle; walking A; walking B; eating with head lowered.
Animation requirement: within each row each animal keeps identical scale, design, palette, silhouette proportions and aligned feet ground baseline. Poses are visibly different but no huge jumps. Body fits fully within each equally sized cell, with at least 30 pixel gutters. Cuddly believable animal proportions without clothes or accessories. Clear eyes and warm pixel shading, no vector smoothing. No text, no labels, no grid, no frame border, no ground circles, no baked shadows, no platform, no background scenery, no white outline. Genuinely transparent background and crisp clean alpha edges.


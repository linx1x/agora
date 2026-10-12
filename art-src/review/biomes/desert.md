# Desert biome artwork

Built-in image_gen mode, original artwork generated 2026-10-12. Style reference: Agora's existing original `apps/web/public/assets/art-review/props.png`. No third-party sprites copied or extracted.

## Reference notes

[Minecraft's official desert feature](https://www.minecraft.net/en-us/article/desert) and [official biome guide](https://help.minecraft.net/hc/en-us/articles/360046470431-Minecraft-Types-of-Biomes) informed the sand, sandstone, cactus and dry-bush vocabulary; the [official camel feature](https://www.minecraft.net/es-mx/article/camel) informed the domestic camel choice. The palette, silhouettes, plant mix and all artwork are original. The approved Agora botanical screenshot governed style continuity.

## Deliverables

- `apps/web/public/assets/art-review/biomes/desert-props.png`: six sprites, 1536 × 1024 RGBA.
- `apps/web/public/assets/art-review/biomes/desert-animals.png`: three species, four poses each, 1536 × 1024 RGBA.
- `apps/web/src/artReview/biomes/desert.json`: measured alpha bounds and equal-size animation frame windows per animal species.

Alpha was checked numerically: empty corners have alpha 0. The image viewer displays RGB color behind some fully transparent pixels; that RGB is not a visible backdrop in normal alpha composition. No background removal or image processing was needed. Props bounds encompass pixels above alpha 10; animal frames preserve shared row baselines and dimensions through the feeding pose. Idle/walk A/walk B/eat order.

## Props prompt

Use case: stylized-concept. Asset type: original game sprite atlas for Agora desert biome. Input image is STYLE REFERENCE only: match its hand-painted pixel-cluster detail, warm small palette, tangible 2.5D shaded forms and charming readable silhouettes. Create a new transparent PNG sheet with exactly SIX entirely separate sprites in a strict THREE columns by TWO rows grid, wide landscape layout, generous transparent gutters and cell margins. Row1 left: tall oasis date palm with curved warm trunk and dusty olive-green fronds; middle: flowering branching cactus with a few coral blooms; right: wiry dry branching desert bush. Row2 left: warm weathered layered sandstone boulder; middle: low blue-sage succulent rosettes; right: natural straw-colored dry grass clump. Slightly elevated front view compatible with an orthographic cozy 2.5D farming world. Tops lit warm upper-left, dark umber and sage shadow planes, visible deliberate pixel clusters, crisp stepped pixel edges. Each prop whole, centered in its own cell, root/foot resting near bottom of its cell. No baked ground shadow, no soil pedestal, no black rectangle, no sticker outline, no white halo, no labels, no borders. Actual transparent alpha background throughout all empty areas. No UI, no text. Use only original artwork.

## Animals prompt

Use case: stylized-concept. Asset type: original game animal animation sprite atlas for Agora desert biome. The provided original Agora props image is STYLE REFERENCE only; match warm detailed hand-painted pixel-cluster texture and cozy readable 2.5D forms. Output a transparent PNG sprite sheet with EXACTLY FOUR columns and THREE rows =12 separate animal sprites; landscape sheet. All animals face RIGHT in a slightly elevated side/front 2.5D view. Row1: same charming warm tan one-humped domestic camel in 4 poses: standing idle, walking legs forward, walking opposite legs forward, eating with neck lowered toward floor. No saddle. Row2: same little cream fennec fox with very large ears and bushy sand-colored tail, same 4 poses: idle, walk A, walk B, nose lowered sniffing ground. Row3: same small olive-brown desert tortoise with honey patterned shell, same4 poses: idle, walk A, walk B, head lowered eating. Maintain each animal's exact body size and design across all4 cells of its row; feet share IDENTICAL BASELINE in every cell of each row, body position constant (only legs/neck move). Walk poses clearly differ. Generous transparent spacing between cells; no overlap or clipping. Warm upper-left light, rich chestnut shadow planes, crisp deliberate small pixel clusters. Entire animals shown including feet and tails. No baked cast shadow, no shadow ellipse, no ground, no sand pedestal, no labels, no letters, no borders, no sticker outline, no white halo. All empty space true transparent alpha. Original artwork only.


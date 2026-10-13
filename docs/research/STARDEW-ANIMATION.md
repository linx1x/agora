# Stardew Valley animation system and the Agora avatar

Stardew Valley's farmer uses discrete body poses, individual frame durations, and callbacks attached to frame boundaries. Clothing follows pose-specific attachment offsets, while tools and effects follow the same animation state. For Agora, the strongest improvements are authored body poses and a shared event timeline for the body, tool, and impact effects.

This investigation covers player locomotion, tool use, harvesting, eating, emotes, wardrobe composition, and associated temporary effects. It is static analysis of the installed **1.6.15.24356** assembly, performed on 2026-10-13. Timings below are declared durations and calculated sums, not measurements of a running game. The follow-up implementation in Agora is described at the end; it uses original code, poses, and timings.

## Evidence and tool coverage

The target is `C:\Program Files (x86)\Steam\steamapps\common\Stardew Valley\Stardew Valley.dll`, 6,268,416 bytes.

- SHA-256: `7f1e5b8e58d2758b78570ba771bbeb03d33522f62188bf6c32edf0cf626deaee`.
- Module MVID: `aa1f513a-94f0-4ef6-a35f-2d5b4a3721bf`.
- [REA](https://github.com/morluto/rea) 6.4.0, provider `rea-dotnet-static`, established the PE/CLI identity. Its main-assembly metadata inspection exceeded the **67,108,864-byte representation budget**. Main-assembly members were therefore unavailable through REA; this does not mean the assembly has no metadata or methods.
- REA returned a member inventory for `StardewValley.GameData.dll`, with coverage labeled partial and no listed coverage issues. Its animation-related metadata includes temporary sprite definitions and pet animation frames; it does not establish the farmer's timing. The provider retains limitations around supported signature forms and static CIL decoding.
- [ILSpy](https://github.com/icsharpcode/ILSpy) 11.1.0.9782 supplied the focused C# reconstruction, metadata coordinates, and CIL excerpts used below. These are supplemental static evidence, not REA-certified reconstructed members. Neither tool executed the target assembly.

The local [evidence index](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/evidence-index.json) records the file hashes, assembly identity, 29 selected method coordinates, and coverage limitations. Full REA envelopes are retained:

| File | REA evidence ID | Coverage |
| --- | --- | --- |
| `artifact.json` | `ev_8eccb2c4b4818a71f866764eb7a11e5519976eee48777515718578c057ce3f56` | Main assembly identity; partial metadata |
| `members.json` | `ev_bd1faf23d7c80ffe997d8d52a866a3b36420c3cbd43198327e91f0784efe5a71` | Main assembly members unavailable at parser budget |
| `gamedata-members.json` | `ev_b9d7ebc23963539eda4bd1df7aeb548f8884b5ca9bbde497f6ec6641cf7440f2` | Companion assembly inventory and CIL anchors; partial coverage |

Raw reconstruction stays in ignored `test-results/stardew-animation/`. This tracked note contains behavioral findings and design implications, not copied game implementation or art. It complements the earlier mechanics note; that note's historical tooling claims are not evidence that this newer REA run admitted the main assembly.

## Animation representation

`FarmerSprite.AnimationFrame` holds a body frame, duration in milliseconds, whole-body vertical and horizontal offsets, an arm variant, a flip flag, and separate callbacks for entering and leaving the frame. The sequence also has looping and completion behavior. The animation identifier is distinct from the body frame: a tool-animation identifier selects a list of body frames rather than directly selecting a tile.

The farmer body has **16 × 32 pixel cells in six columns**. Its source rectangle comes from the body-frame index. Walking, running, carrying, tools, eating, harvesting, and emotes choose different pose sequences. Left-facing locomotion generally reuses the right-facing body poses with a flip. Hair can have independent left-facing art.

Evidence: [frame definition](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerSprite.cs:13), [frame dimensions](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerSprite.cs:560), [source rectangle](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerSprite.cs:832), [sequence selection](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerSprite.cs:1158). Sequence selection is method token `0x060009EA` for this exact assembly hash.

## Timing and action callbacks

The sequence builder declares these representative timings at normal stamina, with tool speed modifier 1 and charge power 0. Movement speed can modify locomotion timing.

| Sequence | Declared frame durations in milliseconds | Nominal total | Relevant callback |
| --- | --- | --- | --- |
| Walk | 200, 200, 200, 200 | 800 | Footsteps checked as frames advance |
| Run down or up | 90, 60, 120, 60, 90, 60, 120, 60 | 660 | Vertical body offsets change through the stride |
| Run sideways | 80, 10, 140, 100, 80, 10, 140, 100 | 660 | Distinct stride and body offset sequence |
| Tool down | 150, 40, 40, 170, 75 | 475 | Swipe at 150; tool action at 190; movement restored at the end |
| Tool sideways or up | 100, 40, 40, 220, 75 | 475 | Swipe at 100; tool action at 140; movement restored at the end |
| Water | 0, 75, 100, 500 | 675 | Tool action on leaving the third frame, nominally at 175 |
| Harvest | 0, 100, 100, 100, 100, 0 | 400 | Item-intake callbacks on successive poses |
| Greeting emote | 250, 250, 250, 250 | 1000 | Sound callback on the first pose |

The important relationship is a short transition into contact followed by a sustained recovery. For the ordinary side/up tool sequence, contact is nominally **140 / 475 = 29.5%** of the sequence; down-facing contact is **190 / 475 = 40%**. These are direction-specific examples, not a universal Stardew impact percentage.

Charge increases a recovery frame by 30 ms per power level before the ordinary tool speed multiplier. The inspected `animateOnce` path doubles its frame durations when the farmer is exhausted and using a tool. Watering uses its own duration entries, so a single speed formula should not be assumed for every tool family.

The player advances a frame when its elapsed timer exceeds the current interval multiplied by an interval modifier. The inspected farmer path advances at most one frame per update and resets the timer to zero. Consequently, zero-duration frames still require an update, and real wall-clock playback can exceed the nominal sums. Agora should preserve elapsed-time remainder and handle skipped frame events correctly rather than reproduce that timer behavior.

Evidence: [walking and running](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerSprite.cs:1187), [tool down](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerSprite.cs:1267), [tool sideways](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerSprite.cs:1297), [water](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerSprite.cs:1451), [harvest](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerSprite.cs:1487), [greeting](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/Farmer.cs:1027), [timer](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerSprite.cs:837), [CIL sequence excerpt](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/AnimationSequence.il).

## Tool lifecycle and multiplayer

The ordinary tool path connects the input state to the sequence and its callbacks:

```mermaid
flowchart LR
  A[Begin tool event] --> B[Stop movement and begin tool]
  B --> C[Charge or release]
  C --> D[Choose directional sequence]
  D --> E[Frame callback draws swipe]
  E --> F[Frame callback uses tool]
  F --> G[Recovery frames]
  G --> H[End callback restores movement]
```

`BeginUsingTool` fires a network event. Its handler stops movement and calls the equipped tool's `beginUsing`. Release selects the appropriate directional sequence. The frame callback invokes `Farmer.useTool`, which calls the tool's gameplay function only for the local player in its normal, non-override path. At sequence completion, `canMoveNow` clears tool-use and animation-pause state.

This demonstrates separation between replaying a visible action and performing its gameplay function. It does **not** establish Stardew's entire multiplayer authority or conflict-resolution model. Agora already has server-validated actions and should retain that model: an animation callback may trigger presentation effects, but must not become a second path that changes inventory or terrain.

Body emotes also use network events and explicit sequences. Emote playback has a short movement grace period and can end when a tool action starts. Some emotes are icon-only; the presence of an emote name does not prove a full-body animation.

Evidence: [tool event handlers and use callback](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/Farmer.cs:6790), [tool release selection](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/Tool.cs:566), [begin and charge branches](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/Tool.cs:625), [emote handler](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/Farmer.cs:2477). `useTool` is token `0x06000937`; its [CIL excerpt](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/UseTool.il) shows the local-player branch at `IL_0025` and gameplay call at `IL_0054`.

## Body and wardrobe composition

The renderer combines a body pose with clothing and accessory layers. Two 126-entry tables provide pose-specific feature offsets. Whole-body position offsets are separate from these attachment offsets. This distinction lets a body dip while a hat, hair silhouette, shirt patch, and facial features stay aligned with the selected pose.

Arms are separate atlas regions selected by frame metadata: normal and secondary variants use offsets 6 and 12, and an offset of -1 hides the arms. The renderer has different depth categories for upward-facing arms and for tools above, beside, or below the farmer. `Game1.drawTool` selects those tool depths from facing and uses the current animation index for tool positions, pivots, rotations, and sprite regions. The tool and body therefore share a discrete pose clock.

Shirts have directional patches; pants reuse body-pose coordinates inside each garment's region. Hair normally has front, side, and back views, with an optional unique left view. Hats can select a covered-hair variant and adjust their anchor for the hairstyle. Certain masks split across depth layers. This is useful for Agora's requested hairstyles, gender/body variants, tops, bottoms, shoes, belts, buckles, vests, and costumes: each garment needs pose-aware alignment, even when several garments share the same attachment rules.

Appearance changes mark recolor state dirty. Pixel positions for palette substitutions are cached; recoloring is performed when needed. Sleeves derive colors from the shirt/dye or skin for sleeveless clothing. Agora already derives sleeve colors from the wardrobe, so the useful extension is pose alignment and layer control rather than an automatic replacement with texture recoloring.

Evidence: [layers and offset tables](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerRenderer.cs:17), [wardrobe composition](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerRenderer.cs:609), [body and arm rendering](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerRenderer.cs:822), [tool rendering](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/DrawTool.cs:100), [recolor caching](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerRenderer.cs:251). The inspected `Game1.drawTool(Farmer, int)` overload is token `0x06000C3B`.

## Effects and other animation families

Temporary effects have their own frame interval, loop count, start delay, motion, acceleration, and completion callbacks. Tool callbacks create these effects rather than baking every particle into the farmer's sprite. Watering, for example, schedules tile splashes and droplets with staggered delays. Eating uses a longer authored sequence with repeated chewing poses and item callbacks; it is not an ordinary tool swing with a different prop.

Evidence: [temporary sprite update](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/TemporaryAnimatedSprite.cs:1683), [watering effects](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/Tools-WateringCan.cs:170), [eating sequence](C:/Users/vince/Desktop/+/agora-plan/test-results/stardew-animation/FarmerSprite.cs:1579).

NPC schedules, monsters, fishing minigames, every weapon special, and modded animation behavior were not traced exhaustively. Names such as `seedThrowDown` also appear in the farmer constants without a corresponding specialized branch in the inspected sequence builder; names alone are not evidence of a working planting clip.

## Applying the findings to Agora

At the time of this investigation, Agora's [motion model](C:/Users/vince/Desktop/+/agora-plan/apps/web/src/game/avatarMotion.ts) provided six procedural poses with shared normalized frame starts for most actions. Tool effects used [a separate swing clock](C:/Users/vince/Desktop/+/agora-plan/apps/web/src/worlds/tools/swing.ts:26), with impact at 66% of a 480 ms base duration, or 316.8 ms. Those shared timing and pose rules limited how distinct the actions felt. The follow-up below replaces that path for avatar actions.

| Priority | Proposed change | Purpose |
| --- | --- | --- |
| 1 | Define per-action sequences with duration, pose, enter/exit events, and interruption policy | Give digging, pouring, gathering, eating, and gestures different rhythms |
| 1 | Use one timeline to select the body pose, attached tool pose, sound, and impact particles | Prevent body contact and effects from drifting apart |
| 1 | Author head, torso, hip, knee, and hand anchors per pose and facing | Produce readable windup, contact, crouch, and recovery silhouettes |
| 1 | Split rear and front arm/tool passes around the body | Keep hands and tools on the correct side of the avatar |
| 2 | Add covered-hair variants and garment attachment rules | Keep hats, hair, belts, buckles, vests, and costumes aligned during strong poses |
| 2 | Define which actions allow movement, cancel on movement, or queue another action | Make action completion and interruption intentional |
| 3 | Profile crowds, then consider a bounded shared cache of rendered motion poses | Avoid repeated drawing for identical avatars without retaining every wardrobe combination |

The existing [figure renderer](C:/Users/vince/Desktop/+/agora-plan/apps/web/src/game3d/paperFigures.ts) already shares walking sheets and reuses each figure's dynamic texture. The cache proposal concerns repeated motion-frame rendering across figures; no performance regression was measured during this investigation.

An Agora action catalog can use the following original families. These groupings are a design proposal, not a claim that Stardew has matching clips for every Agora action.

| Agora actions | Proposed pose family |
| --- | --- |
| Till, raise, lower | Two-handed ground preparation |
| Chop | Overhead chopping with a strong torso turn |
| Mine, remove | Pick or demolition strike |
| Water | Tip, pour, hold, recover |
| Plant, fertilize, feed | Reach down or scatter, release, return |
| Harvest, take, collect | Bend, grasp, lift, recover |
| Place, stash, ship | Carry, extend, release |
| Open, buy | Reach or receive |
| Craft | Repeated work poses with timed contacts |
| Eat, sleep | Dedicated consumption and rest sequences |
| Gestures, idle, talk, sit, stand | Independent social and transition sequences |

For implementation, keep server outcomes authoritative and retain refusal-token cancellation, reduced-motion support, and avatar resource cleanup. Validate that skipped render frames deliver presentation events once, cancellation suppresses pending effects, all four directions preserve clothing anchors, and remote playback never reapplies gameplay. Tune Agora's own timings and artwork through visual review; the Stardew numbers above are reference evidence rather than a requirement to reproduce its assets or exact pacing.

## Agora implementation

Implemented on 2026-10-13:

- Per-family sequences specify individual pose durations and presentation cues. Eating, crafting, waving, laughing, and clapping can repeat poses. Down-facing ground tools have longer anticipation without changing the overall action duration. Tool tier and speed scale the entire sequence and its events together.
- The avatar player delivers crossed cue boundaries once, including when rendering skips several frames. World tool sounds, particles, and camera shake now start at the body's contact cue. Local and remote actions use the same path; local input no longer starts a second independent effect clock.
- Each action family has body bend, torso compression, head anchor, head tilt, knee and stance poses. Clothing follows the torso; facial features, hair and hats follow the head. Separate rear and front arm passes preserve directional depth, and covered hairstyles no longer protrude through hats.
- Movement cancels the current action and pending effects. New gameplay actions replace old ones; speech and gestures do not interrupt an active gameplay action. Refusal cancellation still matches the originating token. Remote position interpolation settles at the action origin rather than being mistaken for new movement.
- A shared LRU cache holds at most 128 rendered motion canvases and four million pixels. Figure textures remain independent and reusable; the shared cache clears when the last figure collection is disposed.

The shader, protocol, inventory, and terrain authority remain unchanged. Validation passed 120 focused tests, TypeScript checks, the production build and scoped lint. Browser checks covered all 21 world actions, live office emotes, editor previews and pause, saved appearances, mobile layout, and reduced motion. The art check inspected 4,464 frames across directions and wardrobe variants for clipping, opaque pixel edges, stable foot anchors, and cleanup. A 50-figure check reused one rendered contact pose (two canvas allocations) without changing another figure's existing texture; this is a CPU/resource check, not a measured game frame rate.

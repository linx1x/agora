# Architecture

## 1. Constraints that shaped this design

- Self-hosted on a Mac (dev/pilot) or your organization's servers (production). No SaaS dependencies
  for core function; everything runs in docker compose plus LiveKit.
- 10–50 concurrent people per space, reachable over the internet, staff only.
- Login through Microsoft Entra ID, restricted to the your organization's tenant.
- Bilingual UI (fr-CA default, en).
- Free-licensed sprites only (see ASSETS.md).
- Built by an AI agent: favour mainstream, well-documented libraries and a single
  language (TypeScript) end to end.

## 2. Component overview

```
Browser (staff)
 ├─ React UI chrome (panels, chat, settings, video tiles)  ─┐
 ├─ Phaser 4 world canvas (tilemap, avatars, interactions) ─┤ apps/web
 ├─ livekit-client (A/V, screen share)                      │
 ├─ Excalidraw + Yjs (whiteboard, notes, kanban)            ─┘
 │
 │ HTTPS / WSS (443)                         UDP/TCP media
 ▼                                            ▼
Caddy (TLS, routing)                         LiveKit server (SFU + TURN)
 ├─ /            → static web build            ▲
 ├─ /api/*       → Fastify (auth, REST)        │ server SDK: tokens,
 ├─ /world/*     → Colyseus (WebSocket)        │ permissions, eject
 └─ /collab/*    → Hocuspocus (WebSocket)      │
                     │                         │
              apps/server (one Node process, three listeners) ─┘
                     │
                 PostgreSQL  ·  uploads volume  ·  (later) Egress + Whisper
```

One Node process hosts Fastify, Colyseus and Hocuspocus on separate ports. At 50
users per space this is ample; the code keeps them in separate modules so they
can be split into processes later (Colyseus supports Redis presence if needed).

## 3. Repository layout

```
apps/
  web/            Vite + React + Phaser
    src/game/       Phaser scenes, avatar renderer, input, interpolation
    src/ui/         React components (panels, dialogs, video strip)
    src/media/      LiveKit wrapper, proximity subscriber, audio graph
    src/collab/     Yjs providers, whiteboard, kanban, notes
    src/i18n/       fr.json, en.json
    public/assets/  sprites, tilesets, registry.json, CREDITS
  server/
    src/http/       Fastify routes (auth, spaces, invites, uploads, admin, api)
    src/world/      Colyseus SpaceRoom, validation, chat, emotes
    src/media/      LiveKit token minting, permission enforcement
    src/collab/     Hocuspocus server + Postgres persistence + auth hook
    src/db/         Drizzle schema + migrations
    src/integrations/ Microsoft Graph, Teams, webhooks
packages/
  shared/         types, zod schemas, constants, collision/zone/proximity math, flags
  maps/           Tiled .tmj maps, .tsx tilesets, map templates
infra/            docker-compose.yml, Caddyfile, livekit.yaml, backup scripts
e2e/              Playwright tests
scripts/          bots, asset checks, seed data
spikes/           time-boxed experiments
docs/
```

## 4. World model

**Tiles.** 32×32 px tiles (LPC scale). Characters use 64×64 LPC frames.

**Map format.** Tiled JSON (`.tmj`). Required layers, by name:

| Layer           | Type   | Purpose                                                                                                                                                                            |
| --------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `floor`         | tile   | ground                                                                                                                                                                             |
| `walls`         | tile   | walls; tiles carry `collides=true`                                                                                                                                                 |
| `furniture`     | tile   | solid or decorative objects; `collides` per tile                                                                                                                                   |
| `props`         | object | small items resting on desks, tables and stacks: point objects (`name` = id, `tile`, `z`, `flip`), base point in px, list order = stacking order (ADR-038, ADR-039); never collide |
| `above`         | tile   | rendered above avatars (doorframes, plant tops)                                                                                                                                    |
| `zones`         | object | polygons/rects with `kind` = `private` · `quiet` · `spotlight` · `broadcast` · `desk` · `door`, plus `zoneId`, `nameFr`, `nameEn`                                                  |
| `spawns`        | object | spawn points, `default=true` on one                                                                                                                                                |
| `interactables` | object | `kind` = `whiteboard` · `embed` · `note` · `poster` · `sign` · `image` · `kanban` · `game` · `portal`; `trigger` = `press` or `walkover`; JSON `props`                             |

The in-app editor (Phase 9) reads and writes the same format, so hand-made Tiled
maps and editor-made maps are interchangeable.

**Blended tiles (ADR-037).** The map stores base tiles only. On the client, natural
ground mixes with neighbouring terrains and joinable furniture (desks, tables,
counters) merges into one object; each such cell's pixels come from formulas over its
3×3 neighbourhood (`packages/shared/src/blend.ts` for the rules and cache keys,
`apps/web/src/game/blend/` for the compositor). Variants sit on a separate tilemap just
above `floor` and `furniture`; the build-mode preview uses the same functions.

**Collision.** `packages/shared/collision.ts` builds a boolean grid from layers at
load time. Avatars use a small feet hitbox (e.g. 16×10 px) for natural movement
around furniture. Same code on client (prediction) and server (validation).

**Movement and sync.**

- Client simulates movement locally at frame rate (speed ≈ 4 tiles/s) and sends
  `{x, y, dir, anim, seq}` at up to 15 Hz.
- Server (Colyseus `SpaceRoom`) validates each update: max distance per elapsed
  time (with tolerance), no collision with solid cells, map bounds. Invalid →
  server sends a correction; client snaps/reconciles.
- Server patches state at 15–20 Hz; clients render remote avatars with ~100 ms
  interpolation buffer. Depth sorting by y.
- Zone membership is computed **on the server** after each accepted move and stored
  in player state (`zoneId`). This drives media access and chat scope.

### Rendering: two views of the office (ADR-052, Phase 16)

The client draws the office in one of two renderers behind one seam. `WorldController`
(`apps/web/src/game/controller.ts`) owns movement, paths, sitting, prompts, the drawn
positions and the presence tick. A view implements `WorldView` (`game/view.ts`: draw the path,
teleport, pan, follow me, where a character is drawn, whether build mode owns the pointer) and
runs its own frame loop. Both publish `window.__agora.view` (`ViewTestApi`), so one e2e spec
drives either view. `playwright.config.ts` has a `2d` project (every spec) and a `2.5d` project
(the `world`, `mobile`, `media` and `build` specs, which hold the privacy tests); `runView()` asserts
which engine ran.

- **Flat view**: `WorldScene` (Phaser 4, `game/WorldScene.ts`), 32 px tiles, 32×40 avatars. The
  default, and the fallback.
- **2.5D view**: `World3DView` (`apps/web/src/game3d/World3DView.ts`, Three.js). Its chunk loads
  only when the view is on. The camera is fixed: perspective, tilted 35°, facing north, never
  rotating. Zoom moves the camera closer and keeps the angle.

Only presentation changes. Positions, collision, zones, proximity, media, `planEdit`, the map
format and the server are the same in both views. Height is client metadata: `shape3d`
(`packages/shared/src/shape3d.ts`) gives every tile a shape (`flat`, `wall`, `box`, `card`,
`decal`, `none`), and a tile may override it with `TileDef.d3`.

**One view** (ADR-054). The 2.5D view is the only world view: there is no setting, no `?view=`
and no flag (`world25d` is retired). A device whose WebGL or view chunk fails gets a notice, and
the People list still works (`GameView.tsx`).

**Device tiers and the quality ladder** (`game3d/tier.ts`, pure and tested). Desktop: 8 point
lights, a 2048 px sun shadow, tilt-shift and bloom. Phone: 3 point lights, no shadow, no
post-processing. A touch screen starts as phone. A 3 s probe after 600 ms of warm-up then sets the
tier: under 40 fps is phone; a software renderer (SwiftShader, llvmpipe) or a probe under 8 fps
starts at the bottom rung. Under 20 fps for 15 s in a row steps the ladder down one rung: render
scale 1 → 0.75 → 0.5, post-processing off, two point lights, lights off (no lamps, shadows or
night blobs). The first step down says so once (a toast in the live region). The rung lasts for the
visit (`store.qualityLevel`); a reload starts at the full look. A personal world steps only its
render scale. The thresholds are first guesses until the mid-range phone run.

**Scene pipeline** (`game3d/scene.ts`, pure). One map region becomes faces: 1 unit is one tile,
x is east, y up, z south, and the camera never sees north-facing faces. Floors lie flat, walls
are boxes (a `wallTop` with its face south of it is one box two cells deep, so collision matches),
desks, tables and counters are extruded from their 3/4 art, other furniture stands up as a card
on its lowest opaque row, and vines hang on the wall north of them. Faces of blended ground and
joined furniture keep their ADR-037 key. `meshes.ts` builds one merged mesh per region and one
texture atlas (tileset, animation strips, blend slots); shade is a vertex colour. Animated tiles
(water, pond, waterfall, fire, portal) move the UVs of their faces (`RegionAnim`). Only the
region the player is in is built, and it is rebuilt on a portal.

**People and labels.** Avatars are paper cut-outs (`paperFigures.ts`, `paperLayout.ts`,
`figureMath.ts`): 64×96 smooth art, one upright card per figure facing the camera, shared sheets
per look, a 120 ms card flip on a left↔right turn (at once under reduced motion). Names, status,
emotes and bubbles are HTML over the canvas (`overlays.ts`, aria-hidden; the People panel is the
accessible list). Props keep their 2D base point; `props3d.ts` places them on a surface and maps
back.

**Occlusion** (`occlusion.ts`, `occlusionMath.ts`). Cells whose faces are walls, vines or cards at
least 0.9 tiles tall fade when they hide my figure (or the figure under the mouse; touch has no
hover). The fade is a 4×4 ordered dither in the shader, one float per vertex, not alpha: the mesh
stays opaque, needs no sorting and stays one draw call. 30 % is kept while hidden; 160 ms each way;
reduced motion jumps.

**Lighting** (`lightRig.ts`, `lightingMath.ts`, `blobs.ts`, `postfx.ts`). The hemisphere takes the
Québec hour's ambient tint from the same curve as 2D (`game/lighting.ts`). A sun runs an arc from
6 h to 20 h (46° at noon, east through south to west). A fixed pool of point lights (8 desktop,
3 phone) holds the lamps, windows, fires, portals and desk lamps nearest the camera, re-picked
at 3 Hz. Trees have blob shadows. Lighting off: plain midday light, no point lights, no shadows,
no blobs, no post-processing.

**Build mode in 3D** (`BuildMode3D.ts`, `pick3d.ts`, `ghost3d.ts`, `propFaces.ts`,
`buildOverlay.ts`). The same edits, shared rules and keys as the flat `BuildMode.ts`, whose
pure helpers now live in `game/buildMath.ts`. The pointer picks the nearest opaque face under
it along a ray (props are hit anywhere in their card), else the floor. The 2D point the server
checks is the image of that hit (`aimOf`). The preview runs the server's own plan on a copy of the
map and draws the changed cells, translucent and red when the server would refuse. One region is
edited at a time: the focus follows the build cursor. The server still gets cells and 2D prop
points.

**Status (2026-10-11).** P16.1–P16.14 and P16.16–P16.17 are built. P16.15 (builder uploads in
2.5D) waits for P9.15. The flat 2D view is removed (ADR-054, P16.19–P16.22): the 2.5D view is
always on, and personal worlds draw in 2.5D too (P17.15).

## 5. Proximity media design (LiveKit)

> Implemented in ADR-031 with these differences: tokens are sent over the world socket
> (`media:grant`) rather than requested; people in a zone stay connected to the floor room
> subscribe-only; the server also reconciles LiveKit against the world every 5 s; and on the
> open floor each publisher limits subscription to its linked people (SFU-enforced), so the
> floor is no longer readable from anywhere in the space by a modified client.

LiveKit is the SFU: each person uploads once; the server forwards to subscribers.
Simulcast on; adaptive stream on; `autoSubscribe: false`.

**Media rooms per space**

- `space:{spaceId}:floor` — every client in the space is always connected.
  Open-floor conversation happens here via **proximity subscription**.
- `space:{spaceId}:zone:{zoneId}` — one per private zone. Joined only while the
  server says you're inside it.

**Open floor (client-side proximity)**

- Each client computes distance to every other avatar on the floor (not in a
  private zone) using shared math.
- Subscribe when distance ≤ `CONNECT_R` (default 5 tiles); unsubscribe when
  > `DISCONNECT_R` (default 6 tiles). The gap is hysteresis to stop flapping.
- Volume = `falloff(d)`: 1.0 within `FULL_R` (1.5 tiles), smooth curve to 0 at
  `CONNECT_R`. Applied per remote audio track (`setVolume`, or a Web Audio
  GainNode once spatial audio exists).
- Video: show the nearest N (default 9) subscribed people; others audio-only.
  Request lower simulcast layers for small tiles.
- The open floor is public by definition, so client-side subscription is
  acceptable there. Document this in PRIVACY.md.

**Private zones (server-enforced)**

- Entering a private zone: server sets your floor-room permission
  `canPublish=false` (via LiveKit RoomService `updateParticipant`), so nothing you
  say leaks to the floor. Client requests a token for the zone room; the server
  mints it only if Colyseus state says you're inside. Everyone in the zone hears
  everyone at full volume.
- Leaving: server removes you from the zone room (`removeParticipant`) and
  restores floor publish permission. A client that ignores the protocol still
  can't hear or be heard inside the zone.
- Tokens are short-lived (e.g. 10 min) and bound to identity + room.

**Quiet zones** (addition): library-style areas where audio/video is off and only
chat works; enforced the same way (no publish anywhere while inside).

**Spotlight and broadcast** (Phase 7)

- Spotlight zone inside a private room: nothing special needed (already full-room).
- Spotlight on the floor: the speaker standing on the spot gets publish permission
  on the floor room and every floor client subscribes to them regardless of
  distance, at full volume.
- Broadcast to whole space: same, and clients inside private zones (still
  connected to the floor room as subscribe-only) subscribe to the broadcaster.
  Per-spot setting `reachesPrivateRooms` (default true for announcer spots).

**Device handling.** Device pickers (mic, camera, speaker via `setSinkId` where
supported), pre-join check page, browser noise suppression / echo cancellation
constraints on, push-to-talk option, auto-mute on Do Not Disturb.

**Bandwidth.** Cap video subscriptions, audio-only mode toggle, automatic
downgrade to audio-only when LiveKit reports poor connection quality.

## 6. Realtime protocols

**Colyseus `SpaceRoom` state (schema)**
`players: Map<sessionId, Player>` where Player = `{userId, name, avatar (string
key into catalog), x, y, dir, anim, zoneId, status, statusMsg, emote, emoteAt,
ghost, afk, floorId}`; `objects` (lightweight object meta); `spotlights`.

**Client → server messages** (all zod-validated in shared):
`move`, `emote`, `chat:send`, `status:set`, `interact`, `follow`, `teleport`,
`knock`, `door:answer`, `game:*`.

**Server → client:** state patches plus `chat:msg`, `notify`, `correction`,
`knock:request`, `media:zoneToken`, `moderation:*`.

**Collab (Hocuspocus/Yjs).** One Y.Doc per collab object, name
`space:{id}:obj:{objectId}`. Auth hook validates the session cookie and space
membership. Persistence: Postgres `collab_docs` (binary update state) with
debounced snapshots; daily version snapshots kept for 30 days for undo/restore.

## 7. Auth and access

- OIDC Authorization Code + PKCE against Entra ID, **single-tenant** app
  registration (only your organization's accounts). Library: `openid-client`.
- On callback: upsert user by Entra `oid`; store email, display name, preferred
  locale. Server session in Postgres, cookie `httpOnly; Secure; SameSite=Lax`.
- Colyseus and Hocuspocus authenticate on connect with a short-lived signed
  token fetched from `/api/session/realtime-token`.
- Roles per space: `owner`, `admin`, `builder`, `member`, `guest` (guest = staff
  member entering by invite link without membership). Platform admins come from an
  Entra group ID set in config.
- Dev mode: `AUTH_DEV_LOGIN=true` shows a "pick a test user" screen. Refuses to
  run in production.

## 8. Data model (Postgres, Drizzle)

```
users(id, entra_oid UNIQUE, email, display_name, locale, avatar_json,
      status, status_msg, created_at, last_seen_at)
sessions(id, user_id, expires_at, data)
spaces(id, slug UNIQUE, name, owner_id, settings_json, capacity,
       password_hash NULL, created_at, archived_at)
space_members(space_id, user_id, role, PRIMARY KEY(space_id,user_id))
invites(id, space_id, token UNIQUE, role, expires_at, max_uses, uses)
maps(id, space_id, slug, floor_index, tmj_json, version, updated_by, updated_at)
objects(id, space_id, map_id, kind, x, y, w, h, trigger, props_json)
desks(id, space_id, map_id, zone_id, user_id NULL)
collab_docs(name PK, state BYTEA, updated_at)
collab_snapshots(name, state, created_at)
channels(id, space_id, kind[space|nearby_log|dm|group], name, created_by)
channel_members(channel_id, user_id, last_read_msg_id, muted)
messages(id, channel_id, author_id, body, mentions[], attachments_json,
         created_at, edited_at, deleted_at)
uploads(id, owner_id, space_id, path, mime, size, sha256, created_at)
moderation_actions(id, space_id, actor_id, target_id, action, reason,
                   expires_at, created_at)
reports(id, space_id, reporter_id, target_id, message_id NULL, reason, status)
events(id, space_id, title, starts_at, ends_at, zone_id, lobby, graph_event_id)
recordings(id, space_id, zone_id, started_by, started_at, ended_at,
           consent_json, file_path, transcript_path, delete_after)
presence_sessions(id, space_id, user_id, joined_at, left_at)  -- analytics source
api_tokens(id, space_id, name, hash, scopes[], created_by, last_used_at)
webhooks(id, space_id, url, events[], secret, active)
audit_log(id, actor_id, space_id, action, target, meta_json, at)
```

Nearby chat is ephemeral by default (not stored), per PRIVACY.md; everyone-chat,
DMs and groups are stored with configurable retention.

## 9. Uploads

Stored on a mounted volume (`/data/uploads`), served through the API with
permission checks (never as public static files). Limits: 25 MB default, MIME
sniffing, images re-encoded server-side (sharp) to strip metadata. Optional
ClamAV container if your IT team requires scanning.

## 10. i18n

i18next with `fr` (default) and `en` JSON files, ICU plurals, locale from user
profile → browser → `fr`. Map labels (zone/object names) have `nameFr`/`nameEn`.
Dates via `Intl`. `pnpm i18n:check` in CI.

## 11. Observability and ops

Structured JSON logs (pino), `/healthz` and `/readyz`, Prometheus metrics endpoint
(players per space, media rooms, message rates). Optional Grafana in compose.
Nightly `pg_dump` + uploads rsync with 14-day retention (see DEPLOYMENT.md).

## 12. Security checklist (enforced in Phase 13, practiced throughout)

CSP with explicit `frame-src` allowlist for embeds; rate limits on chat, emotes,
moves, uploads, knocks; zod validation on every inbound message; CSRF protection on
cookie-auth POSTs; server-side permission check on every mutation; dependency audit
(`pnpm audit`) in CI; no user HTML rendered (markdown subset with sanitizer).

## 13. Personal worlds (ADR-053, Phase 17)

A claimed desk is a portal to its owner's own world. The flag `worlds` is off until checkpoint O.
Each world is a procedural map with four biomes (Meadow, Jungle, Desert, Taiga), rivers that run to
the sea, and Stardew-style farming. The rules are in `packages/shared/src/worlds/`, the server in
`apps/server/src/worlds/`, the client in `apps/web/src/worlds/`.

**Generation (shared, deterministic).** Seeded simplex noise (`noise.ts`) with no dependency and
only `+ - × ÷` and integer operations, so every JavaScript engine gives the same bits. Layers are
elevation, temperature and humidity (fBm). A cell's biome is a weighted blend of four biome centres
in (temperature, humidity), dithered at the borders (`biomes.ts`). Sea level is an elevation
threshold. Rivers are steepest-descent traces over cached 8×8-chunk regions (`rivers.ts`), each
ending in the sea or a lake. Chunks are 32×32 cells of level 0 to 7 (`LEVEL_MAX`), a block and
decor (`terrain.ts`). The seed is `worldSeedFor(userId)`. `worldgen.json` holds `genVersion` and
the params for each version: a terrain change bumps the version and keeps the old params under
`versions`, so saved deltas still match.

**State: deltas only.** The database keeps only what a person changed, in
`world_chunks(world_id, cx, cy, delta, cells, rev)`. The base is recomputed from the seed. A delta
is sparse (`{level?, block?, decor?}` per local cell index, `delta.ts`), capped at
`WORLD_DELTA_CELL_CAP` (40 000 cells per world). The starter is a stamp under the stored edits
(`packages/maps/worlds/starter.json`, `starter.ts`, `mergeDeltas`), so the generator never changes
for it. Farm state is one row per world, `world_sim(world_id, day, state, rev)`: plots, animals
and machines (`WorldSimState`). Account data is not world data: `inventories`, `progress` (skills,
unlocks, energy, day, rest) and `ledger` (key UNIQUE) belong to the person.

**Server room** (`worldRoom.ts`). `WorldRoom` holds the people in one world. `WorldHub` opens it on
the first arrival (concurrent arrivals share one load: the world row, the generator params for its
`genVersion`, every stored chunk) and closes it when the last person leaves. The server decides
every position with `validateWorldMove` on the base plus the deltas; a refused move gets
`world:correction`. A person gets the 5×5 chunks around them (`world:chunks {add, drop}`) and the
farm plots in view (`world:farm`). Messages go only to the people in that world, and `WorldPerson`
carries no user id.

**Clock** (`clock.ts`). One clock per world. A game day runs from 06:00 to 02:00 (1200 game minutes);
the default day is 20 minutes (`DEFAULT_DAY_MS`) and a season is 28 days. The server catches a
world up on load and at each day change, one year at most (`simulateDays`). The night order is:
withering at a season change, growth (only on watered days), water retention, sprinklers, animals,
machines. The client gets `world:time`. Worlds keep running while nobody is in them.

**Actions** (`actions.ts`, skill `agora-world-action`). A person sends `world:act {op, kind, at,
item, key}`. The server checks, in order: permission (`canDo`), reach (1.5 cells), that a planner
exists, and then one transaction (`withTxn`) that locks the world row, replays the ledger row for
`key` or refuses `key_taken`, reads the account, sim and chunks, runs the pure planner
(`packages/shared/src/worlds/actions/`), checks inventory and energy, writes the ledger row and the
changes. A refusal writes nothing. Refusal reasons are a closed list (`WORLD_REFUSALS`, i18n
`worlds.refused.<reason>`). The memory store (dev only) runs transactions one at a time.

**Energy and the day** (`energy.ts`, `rest.ts`). Energy's maximum is 270 (`progression.json`). A
bed restores energy by the game clock. Passing out at the rollover restores half of the maximum.
Away from home, a pass-out costs 10 % of money (capped at 1000), charged once a day through the
ledger.

**Portals** (`packages/shared/src/portals.ts`). A portal is `{id, trigger, access, target}` with a
pixel rectangle as its trigger, the same way zones work. A desk uses its pod's access rule
(`portalAllows` equals `podAllows`). The first step through a desk creates the owner's world
(`ownerWorld.ts`), and a visitor is refused `no_world` until then. Each world has one portal
inside it, the return pad, which leads back to the owner's desk. The owner's uid never reaches a
visitor.

**Media and chat scope.** A world is its own scope, `world:<id>`. Everyone in it is linked to
everyone else at any distance (`peers` for P2P; for LiveKit, a room named from the world id, never
from a user id, through `media:grant {floor: null, zone: {room: 'prefix:world:<id>'}}`). Nearby chat
reaches only the members of that world and is never stored. Signalling relays only within the
world. Nobody outside the world hears or signals into it. The office rules (`isPrivate`,
`isQuiet`, `podAllows`, `mediaLinked`, `chatReaches`) are unchanged. The isolation tests are in
`apps/server/src/worlds/worldRoom.test.ts` and `apps/server/src/world/room.test.ts` ("personal
worlds").

**Content is data.** Blocks, biomes, worldgen params, items, crops, tools, recipes, animals, fish
and NPC gifts are JSON in `packages/shared/data/worlds/`, each checked by zod at load
(`loadGameData()` also checks cross-references). Adding content is adding rows
(`agora-add-world-content`). Art: every block is a placeholder drawn in code from its biome's
palette until a sprite file exists under its key (`apps/web/src/worlds/placeholders.ts`). The
art manifest is in `docs/ASSETS.md` § Worlds.

**Rendering.** The flat view is `apps/web/src/worlds/view2d/`: cells lift 12 px per level with a
darker side strip under each step, and the farm layer is drawn over the ground. The 2.5D view of
worlds comes with P17.15, on the same `WorldView` seam as the office (section 4).

**Progression (P17.31).** Five skills (`SKILLS`: farming, foraging, mining, fishing, combat), one
xp curve (`levelXp`) for all of them. Each action earns the xp its `progression.xp` row names
(harvest, chop and mine today). `progressionStep` (`packages/shared/src/worlds/progression.ts`) runs
once inside `transact`, after the rule: it refuses a held tool whose unlock the actor has not earned
(`locked`) and writes the xp from the table. Unlocks are derived from the actor's own levels, never
from the owner's levels or grants, so a visitor's action is judged by the visitor's xp. The badge is
a skill the person chose (`show_off` table, `badge` message); its level is computed from their xp,
so an unearned level never shows.

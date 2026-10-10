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

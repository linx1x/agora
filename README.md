# Agora

Agora is linxix's self-hosted virtual office: a 2D pixel-art office where walking up to
colleagues opens audio/video with them, meeting rooms are private, and the library
is a quiet zone. French first, English available.

> This repo started from the build kit in `docs/` (plan, architecture, ADRs).

## What works in this version (MVP)

- Multiplayer HQ map: open office, 3 private meeting rooms, quiet library, lounge, reception.
- Server-authoritative movement (speed, walls, bounds) with client prediction and corrections.
- Zones decided by the server: private rooms isolate audio, video and nearby chat; the quiet zone disables media.
- Proximity audio/video through a LiveKit SFU (ADR-031; P2P WebRTC fallback) with volume falloff, speaking ring, video strip, device selection, screen sharing.
- Chat: Nearby (ephemeral, server-scoped) and Everyone (persisted), unread badges, speech bubbles.
- Presence list with area, status (Available, Busy, DND with auto-mute, Away) and locate.
- Emotes (keys 1-6, raise hand), avatar editor, reconnect with seat hold, FR/EN, keyboard shortcuts (`?`),
  screen-reader announcements, Privacy and Credits pages.

**v2 additions:** Atrium hub plus four biome wings (Jungle, Boreal forest, Oasis, Zen garden) joined by
teleporters; 32 claimable L-shaped desk pods whose occupants share a private voice bubble, with Open / Knock /
Closed access set by the owner; sit and stand animations; ray-cast lighting that follows the time of day in
Québec; click-to-move with "Go to person" and "Go to my desk"; call a colleague over; visitor and knock
chimes; desk personalisation (plant, lamp colour, poster, nameplate); minimap and zoom. Keys: `X` act,
`H` my desk, `N` minimap, `+`/`−` zoom.

**Build mode (ADR-021):** desk pods are open on every side. Builders (`BUILDER_IDS`, or anyone who enters
`BUILDER_CODE` in Settings) press `B` or the hammer button to place, move and erase plants, furniture, floors
and walls from a palette of every theme. Changes are checked by the server (no blocked chairs, desks, doors
or teleporters; wings stay sealed), seen live by everyone and saved. Keys in build mode: `Q` brush, `E` eraser,
`I` picker, `G` grid, `O` obstacles, `Ctrl+Z` / `Ctrl+Shift+Z`, `Esc` to leave. In dev mode, set
`BUILDER_IDS=dev-alice` to make the first test user a builder.

**Spaces and invites (ADR-028, ADR-029):** besides the default space, people can create spaces (open, or
invite-only) at `/s/<address>` from the building button in the control bar. Owners and admins change the name,
access, capacity, proximity radii and video cap, and create invite links (role, expiry, number of uses) that also
let people in without the access code. Each person can pick a different name per space. With access-code sign-in,
a browser keeps its identity ("Remember me on this device"), so desks and roles survive signing out.

**Media (ADR-030):** a device check before entering (camera preview, mic level, sound test; mic and camera
start off), push-to-talk with a key of your choice, an audio-only mode, and an automatic switch to audio-only
when the connection is poor (a banner lets you turn video back on).

**LiveKit (ADR-031):** with `LIVEKIT_URL` set, media goes through a LiveKit SFU: one floor room per space and
one room per meeting room or desk pod. The server hands out tokens over the world socket only for the rooms it
places you in, removes you from a room's media as you walk out, and checks LiveKit against the world every 5 s.
Simulcast and adaptive video keep 15–50 people workable. Screen sharing (control bar) reaches the same people
your camera does. Without `LIVEKIT_URL` the P2P fallback is used.

**Art:** original CC0 pixel art for the shared items, Hub fixtures and the four biomes (ADR-022, built from `art-src/`); the Jungle wing has its own layout with a waterfall and pond, dirt trails and animated water (ADR-023), and the Oasis wing has a fountain pool, cabanas and sandstone paths (ADR-024), and the Boreal wing has a fire pit clearing, a frozen pond and slate paths (ADR-025); the Zen wing has a koi pond garden, flagstone paths and a tea and go lounge (ADR-026). The Atrium has its own polished stone plaza, navy rugs and brass fittings (ADR-027), so the Atrium floors, walls and fixtures are original CC0 pixel art too (the Kenney packs of ADR-020 remain only as a fallback for tiles without a sprite). See the in-app Credits page.

ADR numbers in the docs refer to the project's internal decision log.

## Run locally

Requires **Node 22.12+ (Node 24 LTS recommended)**; Node 20 is end-of-life and Vite 8 will not run on it.
With nvm: `nvm install && nvm use` (reads `.nvmrc`).

```bash
corepack enable
pnpm i
pnpm build
AUTH_DEV_LOGIN=true pnpm start          # http://localhost:3000, pick a test user
```

Hot reload: `pnpm infra:up` (optional Postgres), then `AUTH_DEV_LOGIN=true pnpm dev` and open
http://localhost:5173. Without Postgres the server runs in memory.

### Media server (LiveKit)

Download `livekit-server` 1.12+ for your system from https://github.com/livekit/livekit/releases
(Windows: `livekit_<version>_windows_amd64.zip`, put `livekit-server.exe` on your PATH; macOS: `brew install livekit`).

```bash
pnpm livekit          # = livekit-server --dev (keys devkey / secret, ws://localhost:7880)
```

Then add to `.env` and restart the app:

```
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

The server logs `media: LiveKit reachable` at boot. `--dev` is for your own machine only (it gives browsers
public STUN servers and a well-known secret). To let other people in, see `docs/DEPLOYMENT.md` (section D) and
`infra/livekit.yaml`.

With Docker (app + Postgres):

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build   # http://localhost:3000
```

Open two browser profiles (or one private window) to see two people. Camera and mic need
`localhost` or HTTPS.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test       # unit tests incl. private-room isolation
pnpm i18n:check && pnpm assets:check
pnpm build && pnpm e2e                         # Playwright, 2-3 browser contexts with fake media (P2P)
LIVEKIT_BIN=$(which livekit-server) pnpm e2e   # the same suite against a real LiveKit --dev
BOTS=30 AGORA_URL=http://localhost:3000 pnpm bots   # load bots (access-code mode)
```

### Environment variables

Configure these as environment variables (a `.env` file, or your hosting platform's settings):

| Variable                             | Required                  | Description                                                                                                                              | How to get it                                     |
| ------------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| SESSION_SECRET                       | Yes (Secret)              | Signs session cookies. 32+ characters, same value on every instance.                                                                     | `openssl rand -hex 32`                            |
| ACCESS_CODE                          | Recommended (Secret)      | Shared code people type to enter. Empty = anyone with the URL can enter with a name.                                                     | Choose one and share it with pilot users          |
| LIVEKIT_URL                          | Recommended               | `wss://` address browsers use to reach LiveKit. Set = LiveKit media (ADR-031); empty = P2P fallback                                      | Your LiveKit host (see DEPLOYMENT.md)             |
| LIVEKIT_API_KEY / LIVEKIT_API_SECRET | With LIVEKIT_URL (Secret) | LiveKit API key and secret (secret 32+ chars in production)                                                                              | The `keys` of your LiveKit server                 |
| LIVEKIT_API_URL                      | No                        | Where this server calls the LiveKit API when it differs from LIVEKIT_URL (e.g. `http://livekit:7880`)                                    |                                                   |
| MEDIA_BACKEND                        | No                        | `livekit` or `p2p`; default `livekit` when LIVEKIT_URL is set                                                                            |                                                   |
| ICE_SERVERS                          | P2P only (Secret)         | JSON array of TURN servers so calls work across networks, e.g. `[{"urls":"turn:turn.example.org:3478","username":"u","credential":"p"}]` |                                                   |
| DATABASE_URL                         | Auto                      | PostgreSQL connection                                                                                                                    | Provided by the platform                          |
| SPACE_CAPACITY                       | No                        | Max people in the space (default 50)                                                                                                     |                                                   |
| CONNECT_R / DISCONNECT_R             | No                        | Proximity radii in tiles (default 5 / 6)                                                                                                 |                                                   |
| VIDEO_CAP                            | No                        | Max video tiles shown (default 9)                                                                                                        |                                                   |
| CHAT_RETENTION_DAYS                  | No                        | Everyone-chat retention (default 365)                                                                                                    |                                                   |
| FEATURE_FLAGS                        | No                        | e.g. `media=false` to ship chat-only                                                                                                     |                                                   |
| BUILDER_IDS                          | No                        | Comma-separated user ids allowed to use build mode                                                                                       | e.g. `dev-alice` in dev; Entra object ids later   |
| BUILDER_CODE                         | No (Secret)               | 8+ character code that unlocks build mode for a session (Settings)                                                                       | Choose one and give it to the people who decorate |
| MAP_SAVE_PATH                        | No                        | Without Postgres, where builder edits are saved (default `data/maps.json` in development)                                                |                                                   |
| ADMIN_IDS                            | No                        | Comma-separated user ids that are admins in every space                                                                                  | Settings shows your id                            |
| ADMIN_CODE                           | No (Secret)               | 12+ character code that makes a session a platform admin (Settings)                                                                      | Choose one, keep it to IT                         |
| SPACE_CREATION                       | No                        | `everyone` (default) or `admins`: who may create spaces                                                                                  |                                                   |
| HQ_NAME                              | No                        | Name of the default space on first boot (default `Agora`)                                                                                |                                                   |
| IDENTITY_DAYS                        | No                        | Access-code mode: days a browser keeps its identity (default 365, 0 = off)                                                               |                                                   |
| AUTH_MODE                            | No                        | `access-code` (default). `dev` is refused in production. `entra` arrives with PLAN P2.1.                                                 |                                                   |

Steps: **Settings** → **Add variable** → KEY and VALUE → tick **Secret** for sensitive values → **Save**.

## Repository layout

```
apps/web        Vite + React UI + Phaser 4 world + media (LiveKit, P2P fallback)
apps/server     Fastify HTTP + WebSocket SpaceRoom + Postgres store
packages/shared protocol (zod), map/collision/zones, proximity math, flags, avatar catalog
packages/maps   hq.tmj (Tiled JSON) and its generator
e2e/            Playwright multi-user tests
scripts/        bots, i18n and asset checks
docs/           plan, architecture, ADRs, privacy, design
```

## License

Code: [MIT](LICENSE). Original Agora pixel art in `apps/web/public/assets/agora/`: CC0 1.0 (public domain).
Third-party assets keep their own licenses, listed in `apps/web/public/assets/registry.json` and the in-app Credits page.

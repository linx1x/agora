# Deployment

Two targets share one docker compose file with profiles:
- **Mac** — development and a small LAN pilot.
- **Production server** — internet-reachable production for staff.

## A. Mac (development and LAN pilot)

Prerequisites: Homebrew, Node LTS, pnpm (`corepack enable`), Docker Desktop or
OrbStack, `brew install livekit`, Tiled (mapeditor.org) for maps. On Windows see
section D for LiveKit.

Dev loop:
```
pnpm i
pnpm infra:up              # Postgres
livekit-server --dev       # native, separate terminal
pnpm db:migrate && pnpm db:seed
pnpm dev                   # http://localhost:5173
```
Camera/mic need a secure context. `localhost` counts; a LAN IP does not. For a
LAN pilot, run Caddy with its internal CA (`tls internal`) on a hostname like
`agora.local`, and install Caddy's root certificate on test machines.

Entra ID from a Mac: register a separate dev app with redirect URI
`http://localhost:5173/api/auth/callback` (Entra allows `http` for localhost).

Exposing the Mac to the internet is **not recommended**: WebRTC needs UDP ports
and a public IP, laptops sleep, and it bypasses IT. Use the production server for anyone
outside the LAN.

## B. Production server

### Topology
One Linux VM (Ubuntu LTS or RHEL-family) running docker compose:
`caddy`, `web` (static build served by Caddy), `server`, `postgres`, `livekit`,
optional `egress`, `whisper`, `clamav`, `grafana`. LiveKit uses host networking
for UDP performance.

### Sizing (starting point — confirm with the Phase 13 load test)
| | Pilot (≤15 people) | Production (50 in one space) |
|---|---|---|
| vCPU | 4 | 8 |
| RAM | 8 GB | 16 GB |
| Disk | 100 GB SSD | 250 GB SSD (+ recordings) |
| Network | 200 Mbit/s | 1 Gbit/s, public IPv4 |
| GPU | — | optional, only for live captions |

LiveKit CPU and bandwidth scale with how many people see each other's video, not
with total users; the nearest-N video cap keeps this bounded.

### DNS and TLS
- `agora.<your-domain>` → app (Caddy, automatic TLS via ACME or your own certs)
- `rtc.agora.<your-domain>` → LiveKit signalling (proxied by Caddy on 443)
- `turn.agora.<your-domain>` → LiveKit TURN/TLS (see firewall)

### Firewall (inbound)
| Port | Proto | Purpose |
|---|---|---|
| 443 | TCP | web app, API, WebSockets, LiveKit signalling |
| 80 | TCP | ACME HTTP challenge + redirect (optional if you use your own certs) |
| 7881 | TCP | LiveKit ICE over TCP (fallback) |
| 50000–60000 | UDP | LiveKit media (range can be narrowed; ~2 ports/participant) |
| 3478 | UDP | TURN/UDP |
| 5349 or 443 | TCP | TURN/TLS for very restrictive networks — on 443 it needs a second IP |

Outbound: Entra ID (`login.microsoftonline.com`), Microsoft Graph
(`graph.microsoft.com`) from Phase 10, ACME if used. Nothing else.

### Deploy steps (the agent writes `infra/deploy.md` with exact commands)
1. Provision VM, install Docker Engine + compose plugin.
2. Copy `infra/` and `.env.production` (secrets from your secrets vault).
3. `docker compose --profile prod pull && docker compose --profile prod up -d`
4. `docker compose run --rm server pnpm db:migrate`
5. Smoke test: `/healthz`, SSO login, two-person proximity call from two networks
   (office + mobile hotspot) to prove TURN works.

### Backups
Nightly `pg_dump` + rsync of `/data/uploads` and `/data/recordings` to your backup
storage, 14-day retention; restore drill in Phase 13.

## C. IT approval packet (hand this to your IT team)

**What it is.** A self-hosted virtual office for staff: 2D map, proximity
video/audio, chat, whiteboards. Open-source components only; no SaaS; no data
leaves your infrastructure (except Entra ID sign-in and, later, Graph calendar
calls to your own Microsoft 365 tenant).

**Components and licenses.** Node.js app (in-house code), PostgreSQL,
LiveKit server (Apache-2.0), Caddy (Apache-2.0), Colyseus (MIT), Hocuspocus/Yjs
(MIT), Excalidraw (MIT), Phaser (MIT). Optional: LiveKit Egress (Apache-2.0),
faster-whisper (MIT), ClamAV (GPL-2.0).

**Identity.** Entra ID app registration, single tenant, redirect URI
`https://agora.<your-domain>/api/auth/callback`. Delegated permissions:
`openid`, `profile`, `email`, `offline_access`, `User.Read`; Phase 10 adds
`Calendars.ReadWrite` (admin consent likely). An Entra group defines platform
admins; optional group restricts who may sign in at all.

**Data stored.** Name, email, Entra object id, avatar choices, status; chat
messages (space/DM/group) with retention setting; uploaded files; whiteboard and
board content; presence sessions (join/leave times) for analytics; recordings and
transcripts only when started with consent. Media streams are not stored
otherwise. See PRIVACY.md.

**Security.** TLS everywhere, httpOnly session cookies, server-side permission
checks, rate limits, CSP, image re-encoding, optional antivirus scanning, audit
log, dependency audits, documented secret rotation.

**Ops.** Health endpoints, Prometheus metrics, nightly backups, runbook.

## D. LiveKit on a Windows PC (development and a small remote pilot)

Agora's media goes through LiveKit when `LIVEKIT_URL` is set (ADR-031). LiveKit is a
separate program from the app; it can run on the same PC as `pnpm dev` or on its own.

### D1. Only you, on this PC
1. Download `livekit_<version>_windows_amd64.zip` (1.12+) from
   https://github.com/livekit/livekit/releases and put `livekit-server.exe` on your PATH.
2. `pnpm livekit` (= `livekit-server --dev`), leave it running.
3. In `.env`: `LIVEKIT_URL=ws://localhost:7880`, `LIVEKIT_API_KEY=devkey`,
   `LIVEKIT_API_SECRET=secret`. Restart the app; the log says `media: LiveKit reachable`.
4. Two browser profiles on `http://localhost:5173` → walk up to each other.
`--dev` uses a well-known secret and hands browsers public STUN servers: never expose it.

### D2. People elsewhere (e.g. the Paris office) joining LiveKit on your PC
What they need to reach, and why:

| What | Port | Notes |
|---|---|---|
| Signalling + API | 443 TCP → 7880 | Must be `wss://` with a real certificate, because the Agora page is `https://`. Caddy does this (below). Agora's server calls the API through the same address. |
| Media over UDP | 50000–50050 UDP | Range set in `infra/livekit.yaml`; ~2 ports per person. |
| Media over TCP | 7881 TCP | Fallback when UDP is blocked. |
| TURN relay | 3478 UDP (5349 TCP with TLS) | For strict corporate networks; TURN/TLS needs a certificate for the TURN name. |

Steps:
1. A DNS name for your public IP (your own domain or a dynamic-DNS name), e.g.
   `rtc.example.org`, and the ports above forwarded on your router to the PC.
2. Windows firewall (PowerShell as administrator):
   ```powershell
   New-NetFirewallRule -DisplayName "Agora LiveKit TCP" -Direction Inbound -Protocol TCP -LocalPort 443,7881 -Action Allow
   New-NetFirewallRule -DisplayName "Agora LiveKit UDP" -Direction Inbound -Protocol UDP -LocalPort 3478,50000-50050 -Action Allow
   ```
3. TLS in front of LiveKit with Caddy (https://caddyserver.com, needs port 80 or 443 reachable
   for its certificate). `Caddyfile`:
   ```
   rtc.example.org {
     reverse_proxy localhost:7880
   }
   ```
4. Start LiveKit with a real key (keep the secret out of git):
   ```powershell
   $env:LIVEKIT_KEYS = "agora: <random secret, 32+ characters>"
   livekit-server.exe --config infra\livekit.yaml --node-ip <your public IP>
   ```
   Edit `turn.domain` in `infra/livekit.yaml` first. Its embedded TURN replaces the public STUN
   servers `--dev` would give browsers (PRIVACY rule 1).
5. Agora's server (Marketplace Settings, or `.env`): `LIVEKIT_URL=wss://rtc.example.org`,
   `LIVEKIT_API_KEY=agora`, `LIVEKIT_API_SECRET=<the same secret>`. Its log must say
   `media: LiveKit reachable`.
6. Rehearse before the demo with one person in Paris on the office network: walk up to each
   other, share a screen, step into a meeting room. If media never connects but the world works,
   their network blocks UDP and TCP 7881: enable TURN over TLS (step 4, `tls_port`, certificate).

Limits of a home PC: the PC must stay on and awake; every stream crosses your upload link
(budget roughly 1.5 Mbit/s of upload per person who has video on in a group, far less for audio);
and Paris-to-Paris calls travel to Toronto and back (about +100 ms each way). Fine for a
rehearsal or a demo of about 15 people; for the pilot itself, move LiveKit to a VM close to the
users (same steps, Linux) or to the production server (section B) by changing only `LIVEKIT_URL` and the keys.

## E. Switching to invite-only accounts (passkeys, ADR-032/034)

Prerequisites: HTTPS on the final domain (`https://agora.example.com`) and Postgres. Passkeys
are tied to the domain: choose it once.

1. `.env` on the server:
   ```
   AUTH_MODE=passkey
   PUBLIC_ORIGIN=https://agora.example.com
   SESSION_SECRET=<32+ random chars, keep it: invite PINs depend on it>
   # remove ADMIN_IDS, ADMIN_CODE, BUILDER_IDS, BUILDER_CODE, ACCESS_CODE
   ```
   Optional: `PASSKEY_RP_ID=example.com` to share passkeys across subdomains (decide now),
   `SETUP_LINK_FILE=/app/data/setup-link.txt` when you cannot easily read the console.
2. Restart. The console shows a box **"Agora: create the owner account"** with a
   `…/setup#…` link (30 min, renewed while nobody owns the server). Open it, type your name,
   create your passkey. Add a second device right away (phone).
3. People and invitations (person icon in the bottom bar): create an invite per person.
   Send the **link** one way and the **PIN** another (e.g. email + text). For pilot users,
   pick their pilot identity so they keep their desk.
4. After everyone has claimed (or a deadline): `pnpm pilot:purge --before 2026-11-01` lists
   the leftovers; add `--yes` to delete them.

Lost passkey: People → Manage → Recovery link (tick "lost or stolen" to also delete their
passkeys and sessions). Lost **owner** passkey: on the server, `pnpm owner:recover`
(Docker: `docker compose exec web node dist/cli.js owner:recover`), open the printed link.

Local development in passkey mode: `AUTH_MODE=passkey` with `NODE_ENV=development`
works on `http://localhost` (browsers allow passkeys there); the setup link is printed
by `pnpm dev`.


**"It asks me to create the owner again after a restart."** The owner lives in Postgres;
a setup link appears only when the database the server uses has no owner. Check the boot
line `[agora] data: …`: it must say `Postgres at localhost:5432/agora (kept across
restarts)`. Since ADR-036 a passkey server refuses to start when Postgres does not
answer (start it with `pnpm infra:up` first). To see who owns the database:
`docker exec agora-plan-db-1 psql -U postgres -d agora -c "select id, display_name, role from users where role = 'owner'"`.
A passkey made on `https://agora.example.com` only works on that address: on
`http://localhost:5173` the browser has no passkey for it. To sign in on localhost too,
run `pnpm owner:recover` and open the printed link on localhost to add a second passkey.

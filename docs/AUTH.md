# Accounts, sign-in and roles (invite-only)

Status: design agreed on 2026-10-03 (ADR-032). Built 2026-10-04 (ADR-033, ADR-034):
P2.12–P2.17 done; moderation (P2.18) and the audit log (P2.19) not yet.
Replaces the shared access code (ADR-012, ADR-028) and the shared `ADMIN_CODE` / `BUILDER_CODE`
unlocks for any deployment outside a laptop.

## Principles

- **Invite-only.** No self sign-up. Only the owner creates invites. A person exists only
  because the owner invited them.
- **No passwords, no shared codes.** Sign-in is a passkey (WebAuthn). Nothing secret is
  typed into Agora except a one-time invite PIN.
- **No email dependency.** Agora sends no email. The owner delivers invite links himself.
- **Server-side sessions.** Every session is a row in Postgres, so removing a person or a
  device takes effect immediately, including in the world (sockets closed).
- **One owner.** Exactly one account has the owner role; it can only be created or
  recovered by someone with access to the server.

## Domain

Passkeys are bound to `PASSKEY_RP_ID=agora.example.com`, origin `https://agora.example.com`.
Dev uses `localhost` / `http://localhost:5173`. Changing the RP ID later invalidates every
passkey; people would then need a recovery link.

## Roles (platform level)

| Capability                            | Owner | Moderator  |  Builder   |   Member   |
| ------------------------------------- | :---: | :--------: | :--------: | :--------: |
| Enter open spaces, chat, desks, media |   ✓   |     ✓      |     ✓      |     ✓      |
| Enter invite-only spaces              |  all  | if granted | if granted | if granted |
| Edit the map (build mode)             |   ✓   |            |     ✓      |            |
| Mute / kick someone from a space      |   ✓   |     ✓      |            |            |
| Timed ban (≤ 7 days)                  |   ✓   |     ✓      |            |            |
| Change settings of an existing space  |   ✓   |     ✓      |            |            |
| Create / archive spaces               |   ✓   |            |            |            |
| Create / revoke invites               |   ✓   |            |            |            |
| Change roles, issue recovery links    |   ✓   |            |            |            |
| Permanent ban, remove an account      |   ✓   |            |            |            |
| See the audit log                     |   ✓   |            |            |            |
| See and revoke anyone's sessions      |   ✓   |            |            |            |

- The matrix lives in `packages/shared` and is enforced by the server on every route and
  world message, with one test per permission.
- Per-space roles from ADR-029 collapse into: platform role + per-space access list
  (`space_members` keeps who may enter an invite-only space).
- A moderator cannot act on the owner or on another moderator.

## Invites

Created by the owner on the People page. Fields:

- **Display name** (required): pre-filled at sign-up, the person may edit it later. The
  owner's original name stays visible in the admin list so impersonation is easy to spot.
- **Note / email** (optional, for the owner's records only; Agora never emails it).
- **Role**: member (default), builder, moderator. Never owner.
- **Spaces**: which invite-only spaces they may enter (open spaces are always allowed).
- **Expiry**: 7 days by default (1 h to 30 days).
- **Protection**: `PIN` (default) or `open link`.
  - PIN: the invite has a link and a separate 6-digit PIN. The owner sends them through two
    different channels (e.g. link by email, PIN by SMS). 5 wrong PINs lock the invite.
  - Open link: whoever opens it first claims it. For cases where only one channel exists.
- **Pilot identity** (optional): link the invite to an existing access-code user so the
  person keeps their uid, desk, avatar and messages.
- Always **single use**. The link and PIN are shown once; only their hashes are stored
  (token: SHA-256; PIN: HMAC-SHA-256 with a server key).
- Link format `https://agora.example.com/join#<token>`: the token is in the URL fragment, so it
  never reaches server logs, proxies or `Referer` headers.
- Statuses: pending, claimed (by whom, when), expired, revoked, locked (too many PINs).

### Claim flow

1. Open the link → page shows the invitation and its expiry. The secret is removed from the
   address bar at once.
2. Enter the PIN (if required). Only then is the invitee's name shown.
3. Confirm or edit the display name, read the privacy summary.
4. Create a passkey (Face ID, Windows Hello, phone, security key). The account and the
   first passkey are created and the invite consumed in one transaction.
5. Prompt: "Add another device" (recommended), then the device check and the world.

## Sign-in

- Sign-in page (any page while signed out, fr-CA first): one button "Se connecter avec une
  clé d'accès". Discoverable credentials, so there is no username field and no account
  enumeration. (No autofill / conditional UI: it needs a username field.)
- Links on the page: "J'ai une invitation" (paste a link) and "Appareil perdu ?" (explains:
  ask the owner for a recovery link).
- User verification required; attestation `none`; challenges are single-use, stored
  server-side, 5 minutes.
- "Ordinateur partagé" checkbox: 12 h session that ends when the browser closes. Default:
  30 days, sliding (renewed on use).

## Sessions

- Cookie `__Host-agora_session`: random 256-bit id, httpOnly, Secure, SameSite=Lax, Path=/.
  Only its SHA-256 is stored, with user, created, last used, expiry, user agent, coarse IP.
- New session id on every sign-in. All state-changing requests also check `Origin`.
- The 60 s realtime token (ADR-012) is only minted for a live session.
- Revoking a session, removing an account, banning or changing a role closes that
  person's sockets at once (close code 4401 / 4403) and the client goes to `/login`.
- Account page: my passkeys (add, rename, remove; the last one cannot be removed) and my
  sessions (sign out other devices).
- **Step-up:** adding or removing a passkey needs a passkey check less than 10 minutes old
  (signing in counts). Otherwise the browser asks for the passkey again first, so a stolen
  cookie cannot plant a passkey that outlives the session.

## Recovery

- **Members:** the owner issues a recovery link + PIN from the People page (24 h, single
  use). Option: revoke the person's existing passkeys and sessions at the same time. Using
  it registers a new passkey.
- **Owner bootstrap:** on boot, if no owner exists, the server prints a one-time setup link
  to its console (valid 30 min, regenerated on restart until used). Opening it registers
  the owner's passkey.
- **Owner recovery:** `pnpm owner:recover` on the server (needs DB access) prints a fresh
  one-time link. Nothing in the web app can create or promote an owner.

## Abuse protection

- Rate limits per IP and per target: PIN attempts, passkey ceremonies, invite page loads,
  recovery links. Uniform error messages ("invalid or expired invitation").
- Invite tokens, setup and recovery tokens: 256-bit random, compared by hash.
- Headers via Caddy/Fastify: HSTS, CSP, `Referrer-Policy: no-referrer`,
  `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`.

## Audit log (owner only)

Sign-in, failed PIN, invite created / claimed / revoked / locked, role change, recovery
issued / used, passkey added / removed, session revoked, mute / kick / ban, account
removed. Kept 180 days (PRIVACY.md).

## Migration from the pilot

- New `AUTH_MODE=passkey`; the default for production. `access-code` stays available for
  local tests only; production refuses `dev`, and warns loudly on `access-code`.
- `ADMIN_IDS`, `ADMIN_CODE`, `BUILDER_IDS`, `BUILDER_CODE` are ignored in passkey mode
  (roles live in the database) and the server refuses to start in production if they are set.
- Pilot users are claimed through invites (field "Pilot identity"). After a deadline the
  owner runs `pnpm pilot:purge` to remove unclaimed pilot identities and their desks.

## Later

- "Link a Microsoft account" (Entra ID, P2.1) as an extra sign-in method on an existing
  invited account, never as self sign-up.
- Optional email delivery (SMTP) for invites and new-device alerts.

## Where things are (code)

- Shared: `packages/shared/src/roles.ts` (matrix), `packages/shared/src/auth.ts` (schemas, types).
- Server: `apps/server/src/http/sessions.ts` (sessions, revocation, step-up),
  `apps/server/src/auth/webauthn.ts` (ceremonies), `auth/tickets.ts` (links, PIN hashing),
  `auth/routes.ts` (sign-in, links, my passkeys), `auth/people.ts` (owner APIs),
  `auth/bootstrap.ts` (setup link, owner recovery), `src/cli.ts` (`owner:recover`, `pilot:purge`).
- Web: `ui/PasskeyLogin.tsx`, `ui/Claim.tsx`, `ui/Account.tsx`, `ui/People.tsx`, `net/passkey.ts`.
- Tests: `apps/server/src/auth/auth.test.ts` (with `softAuthenticator.ts`, a software passkey),
  `apps/server/src/http/sessions.test.ts`, `e2e/auth.spec.ts` (Chromium virtual authenticator).

## API (all JSON; state-changing calls need a same-origin `Origin`)

| Route                                                                 | Who         | What                                 |
| --------------------------------------------------------------------- | ----------- | ------------------------------------ |
| `POST /api/auth/passkey/options`, `…/verify`                          | anyone      | passkey sign-in                      |
| `POST /api/auth/passkey/reauth`                                       | signed in   | step-up check with my own passkey    |
| `POST /api/tickets/preview`, `…/check`, `…/options`, `…/verify`       | link holder | use a setup / invite / recovery link |
| `GET/POST /api/me/passkeys…`, `PATCH/DELETE /api/me/passkeys/:id`     | signed in   | my passkeys                          |
| `GET /api/me/sessions`, `DELETE …/:id`, `POST …/revoke-others`        | signed in   | my sessions                          |
| `GET/POST /api/admin/invites`, `DELETE …/:id`                         | owner       | invites                              |
| `GET /api/admin/people`, `PATCH/DELETE …/:uid`                        | owner       | accounts                             |
| `GET/DELETE /api/admin/people/:uid/sessions[/:id]`, `POST …/recovery` | owner       | their sessions, recovery link        |

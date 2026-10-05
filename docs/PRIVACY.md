# Privacy (Québec Law 25) — design rules and checklists

Agora handles employees' personal information (identity, voice, video, messages,
presence). In Québec, Law 25 (the modernized private-sector privacy act) applies.
This file turns that into engineering rules. It is not legal advice: review it
with your organization's person in charge of the protection of personal information
(responsable de la protection des renseignements personnels).

## Design rules the agent must follow

1. **Data stays on your infrastructure.** No analytics SDKs, CDNs for app code,
   error-reporting SaaS, or cloud STT. Fonts and libraries are bundled.
2. **Privacy by default.** New users start with camera off; nearby chat is not
   stored; analytics are aggregated; location history is not stored (only
   join/leave times).
3. **Transparency in the UI.** A "Privacy / Confidentialité" page in FR and EN
   explains what is collected, why, retention, and who to contact.
4. **Open floor is public.** The UI makes clear that anyone nearby on the open
   floor can hear you, and private rooms are the place for confidential talk.
5. **Recording requires consent.** Visible indicator for everyone, explicit
   acknowledgement, consent record stored, late joiners prompted (P11.2).
6. **Retention is configurable and enforced** by a daily job: chat (default
   365 days, configurable), uploads with their messages, recordings/transcripts
   (default 30 days), presence sessions (default 90 days), audit log (2 years).
7. **Access and deletion.** Admin tool to export a person's data (JSON + files)
   and to delete/anonymize an account on request.
8. **Minimal Graph scopes**, requested only when the feature is first used.

## Before the pilot (P6.7)

- [ ] Privacy page published in FR/EN.
- [ ] Privacy impact assessment (EFVP) started with your privacy officer —
      Law 25 expects one for new information-system projects involving personal
      information.
- [ ] Pilot participants informed in writing.
- [ ] Retention job running with defaults.

## Before production (P13.7)

- [ ] EFVP completed and signed off.
- [ ] Recording consent flow tested.
- [ ] Data export and deletion tested end to end.
- [ ] Incident response contact listed in the runbook.
- [ ] Interface fully available in French (also expected for workplace tools
      under Québec's Charter of the French Language — confirm with your organization).

## MVP implementation notes (2026-10-01)

- Media is peer-to-peer WebRTC (ADR-009). Streams go browser to browser, or through a
  TURN relay on infrastructure when `ICE_SERVERS` is set. No public STUN by default.
- The server decides who may connect (same private room, or near each other on the
  open floor) and refuses signalling between anyone else. Nearby chat recipients are
  computed on the server and nearby chat is never stored.
- Stored: display name, avatar choices, "Everyone" messages (retention
  `CHAT_RETENTION_DAYS`, default 365, purged daily), join/leave times (90 days).
- Camera and mic start off. The in-app Privacy page (FR/EN) explains the above.
- The open floor is public by design; the UI says who can hear you at all times
  (bottom-right panel).
- Spaces (2026-10-02, ADR-028/029): stored per space are its name, settings, members with their role and
  optional per-space display name, and invite links (only a hash of each link, its role, limits and use count).
  In access-code mode a signed `agora_id` cookie keeps the same anonymous user id on a browser for
  `IDENTITY_DAYS` (default 365); people can untick "Remember me" or use "Sign out and forget this device".
- Sessions (2026-10-04, P2.12, ADR-033): each sign-in is a row in `sessions` with the user id, times, the
  browser's user-agent (200 chars) and a coarse address (IPv4 /24, IPv6 /48), so people can see and end
  their own sessions. The cookie (`__Host-agora_session` over https) holds a random secret; only its
  SHA-256 is stored. Rows are deleted at sign-out and at expiry (30 days unused, or 12 h for a shared
  computer).
- Invite-only accounts (2026-10-04, P2.13–P2.17, ADR-034): `passkeys` holds each device's **public**
  key, a label like "Chrome · Windows" and when it was added and last used (no biometrics ever reach
  Agora). `tickets` holds invites and recovery links: the name and optional note the owner typed, role,
  spaces, expiry and use; the link and PIN only as hashes. `users.invited_name` keeps the name on the
  invite so the owner can spot impersonation. A removed account is disabled: its passkeys, sessions,
  desks and memberships are deleted; its past "Everyone" messages stay until normal retention.
- Media through LiveKit (2026-10-03, ADR-031): streams go through the LiveKit SFU that Agora's
  operator runs; nothing is recorded (no Egress). Private rooms and desk pods each have their own SFU
  room; the server only gives a token for it to people it places inside, removes people as they walk
  out (old tokens revoked) and checks LiveKit against the world every 5 s. On the open floor, each
  person's tracks may only be subscribed by the people the server links them to (SFU-enforced
  subscription permissions). `livekit-server --dev` gives browsers public STUN servers: use
  `infra/livekit.yaml` (embedded TURN, no discovery over public STUN) for anything shared. Screen
  sharing follows the same rules as the camera.
- Media settings (2026-10-02, ADR-030): chosen camera, microphone and speaker ids stay in the browser
  (`localStorage`). The device check is local only; nothing is sent before "Enter". Connection-quality
  statistics are computed in the browser and never sent; only an "audio only" flag is shared with the
  people you are connected to.

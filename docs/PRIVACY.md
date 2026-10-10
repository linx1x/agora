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
- Characters (2026-10-07, P15.3, ADR-044; flag `npcs`, off by default): the characters see only
  connected people on the open floor (never anyone in a private room, desk pod or quiet zone): first
  name, status, position, whether they sit, when they joined. To choose what to do, a character sends
  that, for people within 8 tiles, to Clef-flash on the operator's own machine (`apps/ml`,
  `NPC_DECIDE_URL`); nothing goes to the cloud model for these decisions. A character never
  approaches someone in Busy, Do Not Disturb or Away, and its wave reaches only the people a nearby-chat
  line from it would reach. A local decision log (`NPC_LOG_DIR`, development default `data/npc-log`,
  off in production unless set) keeps one line per decision for `NPC_LOG_DAYS` (30) days with names
  replaced by "person 1", "person 2"… and no account ids or Talk text; it is the training set for
  tuning the characters' own scoring. The Privacy page lines come with P15.5 (memory), before any pilot.
- Talking to characters (2026-10-07, P15.4, ADR-045; flag `npcTalk`, off by default): only a message
  written in the Talk box reaches a character; nearby and "everyone" chat never does. It is refused
  from a private room, desk pod or quiet zone. The message is sorted on the operator's machine (Clef).
  A prepared line answers most messages with no outside call. Only when none covers it, and only if the
  message carries no personal information (emails, long numbers, postal codes and links are removed
  first; a message that had any stays on the server), the text and the person's first name go to the
  configured cloud model. If that provider stores data outside Canada (DeepSeek: China), each person
  first accepts an AI notice naming the provider and country; the acceptance is recorded per account
  and version, can be withdrawn in the Talk box, and is deleted with the account. Replies are said only
  to people a nearby-chat line from the character would reach. The text is not written to logs and the
  short conversation history (six turns, ten minutes) lives in memory only.
- Memory and chats between characters (2026-10-07, P15.5, ADR-046; flags `npcMemory`, `npcSocial`, off by
  default): after a useful conversation a character may keep a short note (600 characters) about what the
  person said about their work or preferences. It is written by the cloud model only from the parts of
  the conversation without personal information, checked by rules, readable only by that person, deleted
  by "Forget everything" in the Talk box, by withdrawing the AI notice, with the account, and after
  `NPC_MEMORY_DAYS` (90) without a refresh. Without a cloud model nothing is kept. Characters chat with
  each other from prepared lines only, and only while a person is within nearby-chat reach of the
  speaker; people in private rooms, desk pods or quiet zones never see or cause it. A character's mood
  and needs are saved once a minute (no person data).
- Voices (2026-10-07, P15.6, ADR-048; flag `npcVoice`, off by default): a character's reply can be spoken. The
  voice is made on the operator's own machine (Chatterbox, built-in voice, never a copy of a real person's
  voice, always carrying the model's inaudible watermark); the reply text does not go to a cloud speech
  service. The clip is sent only to people who turned on "Character voices" and who are still within reach
  of the character when it is ready; never to a private room, desk pod or quiet zone. Clips are cached in
  memory by text and are not written to disk.
- Fitting the scoring (2026-10-07, P15.3b, ADR-047): the decision log (no names, no Talk text) can be used
  to adjust how much each factor counts in a character's own scoring. The result is a small file of
  multipliers, `weights.json`, with nothing about people in it.
- Web searches (2026-10-07, P15.8, ADR-049; flag `npcWeb` and `NPC_WEB`, off by default): when the operator
  turns them on, a question about the news or the outside world may be searched on the web through the
  operator's own SearXNG, which passes it to the search engines it is set up with. Only the words of the
  question leave, without first names or character names, never a message that carries personal
  information, at most 30 searches an hour for the whole server. Enabling it changes the AI notice and
  everyone is asked again. Results are treated as untrusted text and their sites are shown under the reply.

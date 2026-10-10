# Design direction

The pixel-art world is the star. The interface around it should feel like a
calm, well-run Québec office in winter: cool light, clear signage, one warm
signal colour reserved for "someone is live/speaking". UI chrome never competes
with the map.

## Tokens

| Name    | Hex       | Use                                                 |
| ------- | --------- | --------------------------------------------------- |
| Fleuve  | `#17324D` | primary text, panel headers, primary buttons        |
| Neige   | `#F3F6F8` | panel backgrounds (light theme)                     |
| Ardoise | `#4A5866` | secondary text, borders, inactive icons             |
| Ambre   | `#F2A900` | speaking ring, live/recording/broadcast states only |
| Sapin   | `#2F7D5B` | Available status, success                           |
| Cerise  | `#C2364B` | Do not disturb, destructive actions, errors         |

Dark theme: panels `#12202E`, text `#E6EDF2`; Ambre, Sapin, Cerise unchanged
(check contrast ≥ 4.5:1 for text, 3:1 for icons).

Ambre is scarce on purpose: if it appears, something live is happening.

## Type

- **Atkinson Hyperlegible** (SIL OFL, bundled, full French accent support) for
  all UI and name labels. Designed for legibility, which matters for small labels
  over busy pixel art.
- Scale: 13 / 15 / 18 / 22 px; weights 400 and 700 only. Sentence case
  everywhere, in both languages. No all-caps labels.
- Name labels in-world: 12–13 px bold, Neige text with a 2 px Fleuve outline.

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│ [video strip: nearby people, collapses to avatars]           │
│                                                              │
│                                                  ┌─────────┐ │
│              world canvas (full bleed)           │ side    │ │
│                                                  │ panel:  │ │
│                                                  │ people /│ │
│                                                  │ chat /  │ │
│                                     [minimap]    │ events  │ │
│                                                  └─────────┘ │
│ [me: avatar · mic · cam · share · emote · status]  [room name]│
└──────────────────────────────────────────────────────────────┘
```

- Bottom-left control bar, left-aligned; room name bottom-right announces where
  you are (also to screen readers).
- Side panel is one panel with tabs, not a stack of floating cards.
- Collab objects (whiteboard, kanban, embeds) open as a large overlay with the
  world dimmed behind; Esc returns to the world.
- Mobile (ADR-035): one-row dock at the bottom (me · mic · cam · reactions · chat ·
  More), everything else in the More sheet; room chip top-left, zoom/map top-right;
  video strip becomes a swipeable row under them; side panel becomes a bottom sheet
  (side sheet on tablets and in landscape); joystick bottom-left, "Hold to talk"
  bottom-right when push-to-talk is on.

## Principles

1. The map is the navigation. Prefer "walk there" over menus; menus are for
   things that have no place in the world.
2. Location is always legible: you know which room you're in and who can hear you.
   Entering a private room shows a subtle frame tint and "Only people in this room
   can hear you" for 3 s.
3. Motion only responds to actions (doors opening, panels sliding, emotes).
   Day/night and animated tiles respect `prefers-reduced-motion`.
4. Copy is short, plain, and identical in meaning across FR and EN. A button that
   says "Verrouiller la porte / Lock door" produces "Porte verrouillée / Door locked".

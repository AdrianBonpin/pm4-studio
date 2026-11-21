---
name: PM4 Studio
description: gridline — a flat, bordered instrument panel in which the numbers are the loudest thing on the screen
colors:
  canvas: "#0a0a0b"
  surface: "#18181b"
  surface-raised: "#27272a"
  border: "#27272a"
  border-hover: "#3f3f46"
  text: "#fafafa"
  text-muted: "#a1a1aa"
  accent: "#2563eb"
  accent-hover: "#1d4ed8"
  accent-muted: "#60a5fa"
  ok: "#4ade80"
  warn: "#fbbf24"
  err: "#f87171"
typography:
  display:
    fontFamily: "Space Mono, monospace"
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0.08em"
  title:
    fontFamily: "Space Mono, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  body:
    fontFamily: "Outfit, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Outfit, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Outfit, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.12em"
  micro:
    fontFamily: "Outfit, sans-serif"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"
spacing:
  hairline: "1px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.text}"
    rounded: "{rounded.full}"
    padding: "6px 12px"
    typography: "{typography.body}"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.full}"
    padding: "6px 12px"
  button-danger:
    backgroundColor: "{colors.err}"
    textColor: "{colors.text}"
    rounded: "{rounded.full}"
    padding: "6px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
    typography: "{typography.body}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
    padding: "{spacing.md}"
    height: "auto"
  badge:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
---

# Design System: PM4 Studio

## Overview

**Creative North Star: "The Bench Instrument"**

This is a measuring device that happens to be software. The screen sits beside a
physical Reader, a Tag in the user's hand, and the thing they need to know is a
number they will compare with a printout or a door. So the numbers get the size,
the monospace and the accent, and everything else — labels, prose, chrome — gets
out of their way.

The world is **gridline**: flat surfaces, hairline borders, no shadow vocabulary,
dense but never cramped, and dark because the use scene is a desk at night. It is
an incumbent world with its own history, and it is a committed world: the tokens
in `src/index.css` are normative and this document describes them rather than
proposing alternatives.

**Key Characteristics:**

- Flat. Depth comes from a one-pixel border and a slightly raised surface, never
  from a shadow, a gradient or a glow.
- Monospace for anything you would read off the hardware, and for headings;
  the humanist sans for the sentences you read rather than scan.
- One accent (blue) carrying interaction, plus three semantic hues — ok, warn,
  err — that may never be used decoratively.
- Dense: 11px and 12px labels are normal here, because the screen is a panel and
  not an article.
- Dark only. There is no light theme and no plan for one.

## Colors

The palette is deliberately small: a near-black canvas, two raised surfaces, two
hairlines, two text weights, one accent and three meaning colours. Every value is
a CSS custom property under `@theme` in `src/index.css`.

### Primary

- **Working Accent** (`--color-accent` #2563eb): the interactive colour. Primary
  buttons, focus rings, selected navigation, the accent hairline.
- **Working Accent Hover** (`--color-accent-hover` #1d4ed8): derived from the
  accent at run time (`color-mix`), so a custom accent flows through.
- **Working Accent Muted** (`--color-accent-muted` #60a5fa): the readout colour.
  A number read from a Tag is the most important text on the screen and this is
  what it is coloured.

### Neutral

- **Night Canvas** (`--color-canvas` #0a0a0b): the page ground.
- **Panel Surface** (`--color-surface` #18181b): cards, inputs, the side bar.
- **Raised Surface** (`--color-surface-raised` #27272a): secondary buttons,
  badges, anything that has to read as one step above the panel.
- **Hairline** (`--color-border` #27272a) and **Hairline Hover**
  (`--color-border-hover` #3f3f46): the only borders in the world.
- **Primary Ink** (`--color-text` #fafafa) and **Muted Ink**
  (`--color-text-muted` #a1a1aa): body text and secondary text.

### Tertiary

- **Confirmed** (`--color-ok` #4ade80) — a completed, verified outcome.
- **Check This** (`--color-warn` #fbbf24) — the operation finished and the result
  wants verifying.
- **Refused** (`--color-err` #f87171) — failed, refused, or nothing was changed.

### Named Rules

**The One Accent Rule.** Blue means *you can act here* and nothing else. If a
surface is decorative it does not get the accent; if it is interactive it does not
get a second colour to say so.

**The Meaning-Only Colour Rule.** Green, amber and red carry outcome severity and
nothing more. A badge, a chart or a heading never borrows one for interest, and
severity is never carried by colour alone — the word is there too.

## Typography

Two families, each with a job. **Space Mono** is the instrument: readouts,
identities, UIDs, byte dumps, and section headings. **Outfit** is the voice:
labels, hints, prose, and button text.

### Hierarchy

- **Display** (Space Mono, 26px, 0.08em, 1): the one big readout on a band page —
  an EM4100 Identity or a 13.56 MHz UID. There is at most one per page.
- **Title** (Space Mono, 14px): section headings. A heading is a label on a panel,
  so it is mono, small, and set in the primary ink.
- **Body** (Outfit, 14px, 1.5): control text, button text, values in a table.
- **Caption** (Outfit, 12px, 1.6): hints, explanations, empty states.
- **Label** (Outfit, 11px, uppercase, 0.12em): field labels and table headings.
- **Micro** (Outfit, 10px): the rare badge or timestamp. Not for body text.

### Named Rules

**The Two Families Rule.** Space Mono for headings and machine data, Outfit for
sentences. A third family is not a decision this project gets to make casually: the
pairing is the visual identity.

**The Mono Is Not Costume Rule.** Space Mono is used instrumentally, as the type
of measurement — which is why this world overrides impeccable's craft floor on
monospace headings. It is not a "technical" texture: no mono paragraph, no mono
marketing sentence, no mono label where a label's job is reading rather than
measuring.

**The Dense Is Not Tiny Rule.** 11px and 12px are legitimate here because they are
labels and hints beside 14px body text. Nothing that must be read as a sentence
drops below 12px, and no text is set below 10px at any size.

## Layout

- The window minimum is **900×700**, and that is the layout's real constraint: every
  page's primary action is reachable without scrolling at 900×700.
- No page is capped at one narrow column. Prose keeps a readable measure; a
  collection's list-and-detail, a table, or a two-pane workspace uses the full
  content width.
- A band page shows one operation at a time through a segmented control. The
  sidebar is navigation and connection state; it is not a place for preferences.
- Rhythm comes from the spacing scale (8 / 16 / 24 / 32) and hairline dividers.
  Sections are separated by a `border-t` hairline, not by cards.
- The shell never rubber-bands (`overscroll-behavior: none`) and the window does
  not scroll as a whole where a pane can scroll instead.

**The No Second Pane Rule.** If a surface has a list and a thing you selected, they
sit beside each other. Stacking them is how this app previously pushed the item a
user came to edit below an unrelated panel.

## Elevation & Depth

There is no shadow vocabulary. Depth is tonal and one pixel wide:

- **Level 0 — Canvas** (`--color-canvas`): the page.
- **Level 1 — Surface** (`--color-surface` + `border-border`): a card, an input,
  a panel.
- **Level 2 — Raised** (`--color-surface-raised`): a secondary button, a badge, a
  control resting on a surface.

The one exception is the `glass` utility (90% surface, 12px backdrop blur, hairline
border) for a surface that floats over content. It is used sparingly.

**The Border Instead of a Shadow Rule.** If something needs to separate from its
background, it gets a hairline. A drop shadow is a different world's vocabulary.

## Shapes

- **Radii:** `rounded` 4px for badges, 6px (`rounded-md`) for small controls, 8px
  (`rounded-lg`) for inputs, 12px (`rounded-xl`) for cards, and `full` for buttons
  and toggles. Buttons are pills; containers are not.
- **Borders:** one pixel, `--color-border`, brightening to `--color-border-hover`
  on hover. A focus ring is `ring-1`/`ring-2` in the accent, never a border colour
  change alone.
- **No ornament:** no gradient, no glow, no decorative icon tile, no clip path, no
  ornamental divider. An icon appears when it names an action.

**The Flat Box Rule.** No container inside a container. A card holds content, not
cards: nesting bordered surfaces is the pattern this world refuses, and spacing or
a hairline does the grouping instead.

## Components

### Buttons

Pill-shaped, 6×12 padding, 14px Outfit, one-pixel border. Four variants:
**primary** (accent fill), **secondary** (raised surface, muted ink), **ghost**
(transparent), **danger** (error tint with an error border). The danger variant is
for an action that destroys something — a Reset, an Erase, a delete — so the
irreversible control is never the one that looks like every other control. A
button never wraps onto a second line at any supported window size.

### Badges

Small, 4px radius, a 20% tint of a semantic hue with the hue's own ink, 2×8
padding, 12px. A badge carries a value the user needs — a status, a count, a
measured fact. It is not decoration, and a badge that says nothing is removed
rather than restyled.

### Cards and Containers

`rounded-xl`, `--color-surface`, a hairline border, 16px padding, hover brightens
the border. A card is the outermost container on a surface. There is nothing
inside a card that is itself a card.

### Inputs and Fields

`rounded-lg`, surface background, hairline border, 16×8 padding, 14px Outfit, the
placeholder in muted ink at 60%. Focus moves the border to the accent and adds a
one-pixel accent ring. A field's label is 11px uppercase Outfit with 0.12em
tracking, above the value. Machine values are Space Mono.

### Navigation

The side bar is a narrow column of destinations, each a full-width row with an
icon and a label. The current destination carries the accent; the rest are muted
ink and brighten on hover. The Reader's identity, status and firmware sit at the
bottom of the side bar permanently, with Connect and Reconnect beside them.

### The readout

The signature component: one large Space Mono value in
`--color-accent-muted`, 26px, 0.08em, tight leading, with its label above it in
11px muted uppercase. When there is no value it is a muted sentence instead. It
never animates and never abbreviates a number.

## Do's and Don'ts

### Do:

- Let the number be the largest thing on the screen, and put its label above it.
- Reach for a hairline, spacing, or a tonal step before reaching for a container.
- State an absence in words: "not determined", "no tag in the field", "this Reader
  cannot tell you which".
- Keep one primary action per visible mode, pill-shaped, never wrapping.
- Use mono for measurement and sans for speech.

### Don't:

- Don't nest cards, or wrap a section in a container it does not need.
- Don't add a badge, a chip or an icon that carries no meaning.
- Don't write a sentence that restates the heading or the control above it.
- Don't announce a message only with a coloured bar down one side of a box: the
  message carries its own words and, where it helps, its own symbol.
- Don't introduce a shadow, a gradient, a glow, a second accent or a light theme.
- Don't set body text below 12px, or set a paragraph in monospace.
- Don't claim knowledge the hardware does not have — no guessed family names, no
  implied writability, no "verified" the app did not observe.

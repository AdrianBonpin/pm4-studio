# AGENTS.md — PM4 Studio

A macOS desktop app for one USB RFID reader (the NFC-PM4). Tauri 2 + React 18 +
TypeScript + Vite, driven by `bun`; the backend is Rust in `src-tauri/`.

| Path              | Holds                                                                  |
| ----------------- | ---------------------------------------------------------------------- |
| `src/`            | The interface: `pages/`, `components/`, `hooks/`, `lib/` (pure logic)   |
| `src/index.css`   | The design tokens. Normative — this is gridline, not a suggestion      |
| `src-tauri/`      | Rust: HID transport, frames, the library file, the tag operations      |
| `docs/adr/`       | Decisions that are expensive to reverse. Read before reversing one     |
| `docs/tickets/`   | The work in flight, and the graph it follows                           |
| `GLOSSARY.md`     | The domain vocabulary. Binding in code, in copy, and in commit messages |
| `PRODUCT.md`      | Who this is for and what it is allowed to claim                        |
| `DESIGN.md`       | The visual system: gridline, in full                                   |

## Verify before claiming done

```bash
bun install      # once
bun run verify   # the gate
```

`bun run verify` is the ordinary verification command, and the one to quote when
claiming a change is done. It runs, in order:

```bash
bun run build        # design gate, token gate, then tsc --noEmit, then vite build
bun run test         # vitest + jsdom
bun run verify:rust  # cd src-tauri && cargo test
```

The design check is part of `build`, not a command somebody has to remember: a
rule violation exits non-zero there and therefore fails `verify` too. The Rust
step is the slow one — a cold compile is minutes — and it stays in `verify`
because the whole point of the command is that nothing is verified by memory.
While iterating, run the cheap steps on their own: `bun run design:check`
(under a second), `bun run typecheck`, `bun run test`.

Tests are vitest with `environment: "node"`; component tests opt into jsdom with a
`@vitest-environment jsdom` docblock and render against the Tauri invoke boundary
stubbed (`src/test/dom.tsx`). No app-internal module is mocked.

## Design work

**Any UI or UX work — a screen, a component, a style, copy in the interface,
layout, motion — loads the vendored design skill first:**

```
.agents/skills/impeccable/SKILL.md
```

That is the whole rule set, vendored at version 4.10.0 under Apache-2.0 (its
licence and third-party notices sit beside it). Read it from there; it is a
versioned artifact and it is not summarised, restated or copied into this file.
Follow its own instructions for loading the two context documents it reads, which
this repository provides and keeps current:

- `PRODUCT.md` — product truth: users, purpose, capabilities, what may not be
  fabricated.
- `DESIGN.md` — the visual system, with the gridline tokens as the committed world.

### The binding constraints

The skill's guidance is applied through these, and none of them is tradable:

1. **gridline is the incumbent world and it wins.** The tokens in `src/index.css`
   (`--color-*`, `--font-*`), the Space Mono + Outfit pairing, the flat bordered
   surfaces, no overscroll and the 900×700 minimum window outrank the vendor's
   defaults wherever the two disagree. `DESIGN.md` records the disagreement and how
   it resolves; the checked-in allow-list (`scripts/design-allow-list.json`)
   records every detector rule this world overrides, each with a reason.
2. **No nested containers.** A card never holds a card. Group with spacing, a
   hairline, or a tonal step instead.
3. **No badge that carries no meaning.** A badge states a value the user needs — a
   status, a count, a measured fact — or it is removed.
4. **No copy that restates the obvious.** A sentence that repeats its own heading,
   or a control that explains itself by saying what it plainly is, is deleted. The
   vocabulary in `GLOSSARY.md` is what the remaining copy uses.
5. **No message announced only by a coloured bar down one side of a box.** A
   notice carries its own words, and a symbol where one helps. Colour is never the
   only carrier of severity.
6. **No control wraps onto a second line** at any supported window size. This is a
   gate, not a review habit.

### The design check

```bash
bun run design:check
```

Runs the vendored detector over `src/` and reports rule violations, allow-listed
suppressions and the detector's own caveats. **It is a gate:** a violation exits
non-zero, and `bun run build` runs it, so a violation fails the build and
`bun run verify` with it. The redesign is finished; nothing here is advisory.

- A missing engine, a failed download or an unscannable target exits **non-zero**.
  A tool that is not there is never a passing result.
- An allow-list entry without a reason — or one naming a rule the vendored
  detector no longer carries — fails the check. Do not add a suppression to push a
  finding through: fix the finding, or record why this world overrides the rule.
- The detector is development-only. It is not a dependency of the app, nothing in
  `src/` imports it, and it never runs in the shipped bundle. Its first-run engine
  download is a developer-machine concern: on a machine that has never run it, the
  check needs network access once, and a failed download fails the gate loudly
  rather than skipping it.

The detector catches what it encodes and nothing else: taste, hierarchy, copy
quality and the rendered page are the skill's and the reviewer's job. No edit hook
is installed: the check is a command a person or CI runs, not something that fires
on every save.

### The token gate

```bash
bun run tokens:check
```

Reads the palette out of `src/index.css` and every interface source under `src/`
(tests excluded: a test asserting a bad class is gone must be able to name it). A
class naming a border colour the palette does not define fails it, with the class
and the line — Tailwind silently drops such a class, so nothing else in the build
would notice. **It is a gate:** a violation, a missing palette, a palette defining
nothing, an unscannable target and a target with no sources in it all exit
non-zero, and `bun run build` runs it, so `bun run verify` fails with it. Its
remit is that one shape only; `border-2`, `border-t`, `border-none`,
`border-border/50` and `border-[#123456]` are not defects.

## Updating the vendored skill

`.agents/skills/impeccable/` is a copy of upstream Impeccable at tag
`skill-v4.10.0` (`https://github.com/pbakaus/impeccable`), including its licence
and notices. Updating it is an ordinary branch and PR: replace the directory, keep
the licence and notices, re-run `bun run design:check`, and re-read the diff —
these are markdown instructions an agent will follow.

## Vocabulary and decisions

- `GLOSSARY.md` first, then `docs/adr/`, then `PRODUCT.md` and `DESIGN.md`. Naming
  a thing wrongly is a defect here, not a style note: a Tag is not a badge, a UID
  is not an Identity, a Reset is not a factory restore, a Signal is audible and a
  Toast is on screen.
- A capability is presented as working only where it is verified on hardware. If
  the reader cannot report something, the interface says so.

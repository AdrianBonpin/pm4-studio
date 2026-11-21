# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The interface is React 18 in a Tauri 2 webview, shipped as a macOS desktop app.
There is no browser build, no mobile build and no server. Nothing here is a
marketing surface: every screen is a tool somebody is using with a Reader plugged
in beside them.

## Users

One person at a desk: a technician, installer, or maintainer who holds physical
RFID Tags and needs to know what is on them, change what is on them, or produce
more of them. They are not a developer. They work in short bursts — read a
credential, write a fob, hand it over — often at night, often with the machine
beside a bench rather than in front of them.

Their job, in order of frequency: read a Tag and trust what it says; write an
Identity they already know; clone one credential onto several Blanks; inspect a
13.56 MHz Tag closely enough to decide whether the app or the Tag is wrong.

## Product Purpose

PM4 Studio is the desktop counterpart to one USB reader (the NFC-PM4, VID:PID
`0483:4343`). It reads and writes 125 kHz EM4100/T5577 Tags, reads and writes
13.56 MHz ISO14443-A NDEF messages, clones Identities in batches, and dumps
memory. It exists because the vendor's own software explains nothing and reports
every result as though it were a success.

Success is that a person can tell, without reading carefully, what the app just
did to a Tag and whether it worked.

## Positioning

Honesty about what the hardware can and cannot report. The protocol carries no
chip family on a 125 kHz read and no writability flag at all, so the app says so
rather than offering an operation it cannot qualify. A capability is presented as
working only where it has been verified against real Tags, and a claim the app
cannot support is labelled unavailable rather than hidden.

## Operating Context

- One Reader, one app, one machine. A mutual-exclusion lock means a second
  process cannot open the Reader while the first holds it.
- The Tag is physical, and the write position matters: an operation that needs a
  specific Tag in the field has to observe that the field is empty and that the
  right Tag arrived. The user reseats Tags constantly.
- The app is used at a desk with a beeper that is already there: audible feedback
  is useful precisely because the screen is not always being watched.
- The window is at least 900×700. There is no phone-sized layout and no light
  theme; the use scene is a desk at night.
- The library is a local JSON file in the app data directory. No account, no
  sync, no telemetry, no network call of any kind.

## Capabilities and Constraints

- **Stack:** Tauri 2, React 18, TypeScript, Vite, bun, and Rust with `hidapi`.
  NDEF encoding and decoding are implemented in-repo; the dependency list stays
  short on purpose.
- **Bands.** 125 kHz: read an Identity, write one, Reset a Tag, Clone, and batch
  Clone. 13.56 MHz: read a UID, card type, capacity and NDEF message; write a
  message; copy a whole message between Tags; erase NDEF content; dump memory.
- **Vocabulary.** `GLOSSARY.md` is binding. A Tag is not a badge, a fob, a chip or
  a card; an Identity is not a UID; a Reset is not a factory restore; a Signal is
  audible and a Toast is on screen.
- **Writability is unknowable before a write.** The 125 kHz reply carries no
  writability flag, so the app states that the first write is the test and does
  not offer a probe. ADR 0007.
- **Refusals are outcomes.** A write whose read-back cannot confirm it is
  *unknown*, never success and never a definitive failure. A Tag that will not
  accept writes is its own outcome with its own cause named. ADR 0003.
- **Never write blind.** A write requires a successful read of the Tag in the
  write position, and never writes an Identity the Tag already presents. ADR 0001.
- **Deliberately absent:** 13.56 MHz password set/remove, MIFARE Classic sector
  access, transparent APDU passthrough, T5577 configuration-block writes, a
  writability probe, Windows and Linux targets, and any network feature.
- **Terminology the interface owns:** Outcome, Signal, Toast, Quiet level, Blank,
  Snapshot, Draft, Record, Collection, Diagnostics, Reset, Erase, Copy, Clone.

## Brand Commitments

- **gridline** is the incumbent visual world, and it is binding: its tokens, its
  Space Mono and Outfit pairing, its flat bordered surfaces, its 900×700 minimum.
  `DESIGN.md` records it. Impeccable's defaults defer to it and never override it.
- The name is PM4 Studio. The protocol credits belong in Settings, not on every
  page.

## Evidence on Hand

- `PROTOCOL.md` — the measured command set and reply layouts, including the two
  real 13.56 MHz captures that settled the reply layout.
- `src/lib/*.test.ts` — the encoding, decoding, guard and classification rules,
  as tests.
- `docs/adr/` — the decisions that are expensive to reverse.
- There is no user research, no analytics and no benchmark. Nothing in the
  interface may claim usage numbers, adoption or speed that was not measured on
  this hardware.

## Product Principles

1. **Say what happened.** Every operation the user starts ends in exactly one
   Outcome, reported through one seam that drives both the message and the sound.
2. **Never imply knowledge the hardware does not have.** Unresolved means
   unresolved: raw bytes and a reason, not a plausible family name.
3. **The absence of a capability is stated once, where it belongs**, not repeated
   as a disabled control on every screen.
4. **Silence is information.** No Tag in the field is not a failure; a failure is
   never silent.
5. **Destructive actions ask, in words, naming what will be replaced.**

## Accessibility & Inclusion

- Every audible outcome has a visible counterpart, so a user with the quiet level
  off, or with no hearing, loses nothing.
- Messages are announced politely without taking focus, every message is
  dismissible from the keyboard, and severity is never carried by colour alone.
- Text contrast is held above WCAG AA against the dark surfaces, and body text is
  never smaller than the design system's smallest documented step.

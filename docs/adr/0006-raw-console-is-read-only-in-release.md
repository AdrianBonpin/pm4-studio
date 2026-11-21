# 0006: The raw console is read-only in release builds

**Status:** Accepted
**Date:** 2026-11-22

## Context

The raw console sends an arbitrary frame to the Reader. It is how this protocol was
cracked: every verified frame in `docs/PROTOCOL.md` — the version reply, the 125 kHz
read layout, the 24-byte write payload, the 21-report NTAG read, the multi-page write
with its per-page state codes — was found by typing a frame and reading what came
back. It is also the instrument still owed for the open hardware questions: what sets
the T5577 lock bit, whether a 124-page message fills, what a page state of `4` during
a write means.

It is also the only surface in the app that reaches the protocol without passing a
guard.

Every guard in this codebase is a decision about *what a frame is allowed to mean*.
The 125 kHz write guard refuses to write a Tag it could not first read, and refuses a
Tag that already presents the target Identity (ADR 0001). The NTAG write path refuses
a Draft larger than the Tag, refuses an empty Draft, and refuses to write without a
read-back plan. Those guards are worth their complexity because the operations they
restrain are destructive and irreversible: a short `0x0073` payload wedges the
firmware until a physical replug, one T5577 in this project is already permanently
locked, and `0x0082` can write config pages 131, 133 and 134 — the NTAG area where
locks and access conditions live. Writing those pages is the one action available in
this app that can make a tag permanently unusable.

A raw console that accepts `0x0082` with a hand-computed payload is therefore not a
convenience. It is an unguarded route to exactly the outcome the rest of the app is
built to prevent, and ticket 21's implementer flagged it as the residual path when
recording what password support could not protect against.

Three constraints make "just remove it" unattractive.

1. It is the only way to answer a protocol question without a code change. The
   remaining open questions in `PROTOCOL.md` are all of that shape.
2. Its diagnostic value is disproportionate: when the app reports a decode it cannot
   justify, the console is how that is turned into evidence.
3. Removing it would leave `PROTOCOL.md` describing frames that nothing in the
   shipped app can reproduce.

The threat is not an attacker. It is a user — most likely the author — reaching for
the console to check one thing, typing a frame from a note, and bricking a tag that
costs money and cannot be replaced by a retry.

## Decision

**Release builds accept only commands with no effect on a Tag's contents. Debug
builds accept anything.**

The allow-list is explicit and closed. A command is permitted in a release build only
if it cannot change what a Tag holds:

| Command | Permitted in release | Why |
|---|---|---|
| `0x0051` wake | yes | selects the Reader, no tag involvement |
| `0x0053` beep and LED | yes | reader actuator, no tag involvement |
| `0x0054` firmware version | yes | pure read |
| `0x0055` LED off | yes | reader actuator, no tag involvement |
| `0x0069` 13.56 MHz poll | yes | pure read |
| `0x0072` 125 kHz read | yes | pure read |
| `0x0081` NTAG read | yes | pure read |
| `0x0083` NTAG info | yes | pure read |
| `0x0073` 125 kHz write | **no** | the destructive 24-byte path |
| `0x0082` NTAG write | **no** | can write config pages 131/133/134 |
| anything else | **no** | unknown effect is the same as a bad one |

**The rule is an allow-list, not a deny-list.** A new opcode is refused in release
until someone states why it is safe, in this table. That is the opposite of the
default a deny-list would give, and it is the only version that stays correct when
the protocol grows: `0x0081` through `0x0085` were all discovered by accident, and
the next discovery will not announce whether it writes.

**The refusal explains itself.** A blocked frame reports that this build only sends
read commands, names the command that was refused, and says that write experiments
run under a development build. A refusal that only said "not permitted" would read as
a bug, and the next thing a frustrated user does is look for a way around it.

**The console says it is read-only before it is used**, not after a frame is refused.
The distinction between a console that can write and one that cannot is exactly the
kind of thing that is safe to state once and unsafe to leave to discovery.

**Debug builds keep the full range.** `#[cfg(debug_assertions)]` decides. This keeps
the research instrument, and makes the dangerous mode something you have to run from
a terminal rather than something you can reach by accident in the app you use daily.

**The frontend reflects the capability rather than assuming it.** The backend is the
authority; the console asks which mode it is in and marks itself accordingly, so
there is one check rather than two that can disagree.

## Consequences

- The shipped app cannot write a Tag's config pages through any path. The
  destructive operations that remain — clone, author, blank, write a Draft, erase,
  set a password — all pass a guard and all show a confirmation naming what they
  destroy.
- Answering the next protocol question now means `cargo run`, not opening the app.
  That is a real cost, paid deliberately: it is the difference between a decision made
  once at a terminal and a mistake made once at a desk.
- The allow-list becomes a maintenance obligation with a failure mode that is safe by
  construction. Forgetting to add a new read command makes it unavailable in release;
  it does not make a write available.
- Debug builds are not somehow safe, and this ADR does not claim they are. A
  development build can still brick a tag, exactly as before. What changed is that
  the capability is now deliberate rather than ambient.
- `PROTOCOL.md`'s research instructions gain a precondition: the frames it documents
  are reproducible from a development build. Anyone following them in the shipped app
  will find the writes refused, which is the intended reading of that document.

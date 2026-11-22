# 0009: The audible alphabet is one chirp, two chirps, three chirps, or silence

**Status:** Accepted
**Date:** 2026-11-22

## Context

The Reader's beeper looks more expressive than it is. Command `0x0053` chirps
once and drives the LED on; `0x0055` turns the LED off and is not a beep at all,
which an earlier build got backwards and which is why beeps never fired for a
while. There is no pitch control, no duration control and no volume control, and
the firmware does not acknowledge the frame, so the app cannot confirm a chirp was
even produced.

That rules out the vocabulary people reach for first. "A short beep for success
and a long beep for failure" is not expressible: a long beep can only be faked as
two chirps with a tight gap, which is then indistinguishable from two chirps. A
rhythm alphabet with short and long elements therefore collapses into a count
alphabet — while adding a timing parameter that can drift between firmware
revisions.

What is genuinely available is **count**, the **gap between chirps**, and a
**boolean LED**. Those are three dimensions and they are enough.

The property the alphabet has to deliver is narrow and specific: a failure must
not sound like a success. Before this decision, every operation that beeped at all
beeped identically, and no failure beeped at all, so the beeper could not carry
information in either direction.

## Decision

Four symbols, distinguished by count and by absence.

| Symbol | Meaning |
|---|---|
| one chirp | **Done** — completed and confirmed good |
| two chirps | **Needs you** — completed, but the result needs checking |
| three chirps | **Attention** — failed, refused, or nothing was changed |
| silence | **Nothing happened** — no tag latched, nothing to act on; not an error |

The gap between chirps is a tuned constant: **400 ms**, measured by ear on the
hardware. It was written here as a nominal 120 ms before anything had been
listened to, and 120 ms was wrong — at that spacing two chirps ran together into
one longer beep, so *needs you* was indistinguishable from *done* and the two-symbol
half of the alphabet did not exist in practice. At 400 ms one, two and three
chirps are each countable, the LED's two-second hold after an attention signal is
legible in a loud room, and a twenty-attempt batch is still intelligible as it
runs. The constant is `CHIRP_GAP_MS` in `src/lib/chirpSequence.ts`, and every
producer and player reads it from there. On Attention the LED is held on for two
seconds so the signal survives a loud room or headphones. Signals are serialised
through a bounded queue so concurrent operations cannot interleave into noise, and
identical adjacent outcomes coalesce.

Silence is a symbol, not a fallback. It is what distinguishes "there was no tag in
the field" from "the tag was there and the reader failed", which are the two
states a user most needs to tell apart and which the app currently renders
identically.

The vocabulary has no fourth count for "critical". A fourth count is
indistinguishable from three at speed, and a distinction that cannot be perceived
is not a distinction.

## Consequences

- Failure, success and "check this" are three different sounds for the first time.
- The LED becomes a second, silent channel. A user who cannot hear the beeper, or
  who works where it cannot be heard, still gets the message; the signal is never
  the only report of an outcome.
- The alphabet is a learned convention. Changing it later is a breaking change to
  how the app feels, which is why it is written down here rather than left to be
  edited as copy.
- The chirp duration and the gap constant are empirical. The duration is the
  firmware's and unknown to the host; the gap was tuned on hardware and is 400 ms,
  not the 120 ms first guessed here. The guess was not a harmless one: it collapsed
  *needs you* into *done*, which is half the alphabet. Any later change to that
  constant is a change to how the app sounds and needs to be listened to before it
  is recorded here.
- Because the firmware never acknowledges the frame, the app must never state that
  a beep was heard. It states what it sent.

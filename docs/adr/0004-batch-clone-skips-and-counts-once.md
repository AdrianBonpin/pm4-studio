# 0004: A batch attempt on a Tag that already carries the Identity is skipped, and never counted twice

**Status:** Accepted
**Date:** 2026-11-21

## Context

A Batch Clone holds one source Identity and writes it to successive Blanks: read
the original once, then one Blank per recipient. ADR 0001 governs every attempt,
and its consequences section says so explicitly — "batch writing must re-read
between attempts, so 'write the same Identity to N Blanks' cannot collapse into N
rapid fire writes".

That leaves one case the single-Clone path never had to name. ADR 0001 refuses a
write when the Tag in the write position already presents the Identity being
written, because the same reading is what the source Tag left in place produces,
and writing that is how a T5577 was permanently locked. In a batch, **after write
#1 succeeds the Tag in position presents the target**. So:

- the guard refuses attempt 2 (correctly), and
- a naive loop reports that as the same refusal the user sees when they have
  failed to seat a Blank, which is false: the Tag is exactly right, and
- the tempting shortcut is to bypass the guard "because we know what is there" —
  which throws away the only protection against writing the source Tag, and is
  the exact ordering that locked a chip.

Two physically identical Blanks cannot be told apart either. The Reader reports
an Identity, not a chip serial, so a Blank that was never written and a Blank
written a minute ago and put back look the same to this app. The spec's open
question — "how to distinguish two identical Blank tags across batch attempts" —
has no answer at this layer, so batch mode must not claim per-Tag certainty.

## Decision

**The guard is unchanged and is still evaluated per attempt.** Every attempt
re-reads the Tag in the write position and writes nothing when it cannot read it.
There is no bypass, no "known state" fast path, and no per-run decision that is
reused across attempts.

**The same-Identity refusal is reported as its own outcome, `skipped`.** It says
what happened ("this tag already reads as `<id>`, nothing was written") and names
the two likely causes — the original still on the Reader, or a Tag already written
in this run — then tells the user the next attempt needs a **fresh** Blank. It is
not worded as a seat-the-tag failure and it is not an error to dismiss: the run
continues, and the next attempt is decided from scratch.

**A skip is structurally incapable of counting.** `BatchOutcome` wraps the copy
path's `WriteOutcome` (`refused`, `verified`, `unverified`, `failed`) and adds
`Skipped`; a skip maps to `Refused` for recording, so
`WriteOutcome::counts_as_confirmed_copy` remains the only counting rule
(the same choice ADR 0003 made for blanking). `BatchRun::confirmed_copies` counts
verified attempts and nothing else.

**The count is per verified attempt, not a claim about physical Tags.** That is
the honest unit: two identical Blanks cannot be distinguished, so the app counts
what it observed. The UI says so, and says each attempt needs a fresh Tag.

**The run holds the Identity, the device loop does not.** The webview reads the
source once and passes it to every attempt, so no attempt can re-read the source
and none can write a different Identity because a Tag was swapped at the wrong
moment. The Reader lock (`deviceLock`) is held for the whole run, so background
polling cannot put a question to the Reader between attempts.

## Consequences

- Leaving a written Tag on the Reader and pressing the button again produces a
  skip and leaves the count alone. The inattentive loop is safe by construction
  rather than by admonition.
- A batch reports attempt by attempt: five outcome names, each attempt with its
  own message. There is no aggregate "the batch worked" verdict to hide a refusal
  behind, and one refusal never ends the run.
- The user is told, before the first attempt, that two identical Blanks cannot be
  told apart and that each attempt needs a fresh Tag. Producing fobs for five
  people therefore means five Blanks on and off the Reader, not one Blank pressed
  five times.
- `skipped` is the batch's word; the single-Clone path still reports the same
  guard decision as a refusal, because with one destination the likely cause is a
  Tag seated badly.
- Whether `0x0073` actually lands on a T5577 is still a hardware question.
  `src-tauri/examples/batchprobe.rs` is the repeatable probe; the decision above
  is proven by tests that need no Reader, which is the limit of what it claims.

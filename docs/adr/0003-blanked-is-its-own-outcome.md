# 0003: A blanked write is its own outcome, not a failed verification

**Status:** Accepted
**Date:** 2026-11-21

## Context

Blanking a 125 kHz Tag means writing the neutral Identity — customer `0x00`,
data32 `0x00000000` — over whatever the Tag held. The protocol's only write
command, `0x0073`, has no acknowledgement, so the sole evidence of a write is a
subsequent read (ADR 0001).

That collides with the Identity codec. `Identity::from_read_payload` reports
`None` when the data field is all zeros, because an all-zero field means "no
reading" — it is what a Tag whose Identity is gone looks like. Ticket 01's
implementer flagged the consequence: **a blanking write that works produces a
read-back this app decodes as "no tag present"**, so judging it by the copy rule
would report every successful blank as *unverified*. Verification by
construction is impossible; the outcome model has to say what blanking actually
is.

Three other facts shaped the decision.

1. A tag can be read before it is written, and ADR 0001 makes that guard
   load-bearing: writing blind is what locked a T5577.
2. Blanking destroys a credential rather than creating one. If it counted as a
   copy, the library would claim Tags carry an Identity that no longer exists.
3. The confirmation is the last thing between a user and a destroyed
   credential, so it has to name the value about to be lost.

## Decision

**Blanked is a fifth outcome, beside refused, verified, unverified and failed.**
It is produced only when the write was transmitted *and* the re-read found no
Identity. It is never called "verified": nothing was copied, so there is nothing
to verify. `WriteOutcome::counts_as_confirmed_copy` stays true for `Verified`
alone, which is what keeps ticket 09's counting honest without a second rule.

**The blanking classifier is separate from the copy classifier.**
`write_outcome::classify_blank` judges the same evidence with the success
condition inverted:

| Evidence | Copy outcome | Blanking outcome |
|---|---|---|
| guard refused | refused | refused |
| not transmitted | failed | failed |
| re-read presents no Identity | unverified | **blanked** |
| re-read presents an Identity | verified if it matches the target, else unverified | **failed** (it did not take) |
| transmitted, re-read impossible | unverified | unverified |
| every re-read replied too short to decode | unverified | unverified |

Two asymmetry rules matter. A re-read that presents an Identity ends the scan at
once, because a Tag that demonstrably still holds a credential must never be
talked out of that by later silence. "No Identity" is concluded only after a
whole quiet window of re-reads, because the firmware can need a moment after a
write before it reads the Tag again.

**The guard fails closed, with rules shaped for blanking.** `blank::decide`
refuses when nothing could be read (ADR 0001, not overridable), when the Tag
already carries no Identity (nothing to blank, so a pointless write is a
pointless risk), and when the Tag presents an Identity other than the one the
user confirmed. The confirmation therefore has to be fed back into the write:
`lf_blank(customer, data32)` carries the confirmed Identity, so confirming Tag A
and blanking Tag B cannot happen silently.

**Nothing in the library changes.** Blanking is not recorded as a write count and
does not edit the Snapshot that describes the destroyed Identity. A Snapshot
records what a Tag held when it was read, not what a Tag holds now.

**The feature is labelled blanking everywhere.** It is not a factory reset and
it does not unlock a Tag: a T5577 configuration block cannot be written and a
chip that has stopped accepting writes stays that way, so either claim would be
false. The confirmation states three consequences before the write is offered:
the write is permanent, the Tag may afterwards read as empty, and the Tag may
become unusable for further writes — the last one because one of this project's
own T5577 blanks is already permanently locked from an earlier experiment.

## Consequences

- The user is told "blanked", and told that a blanked Tag reading as empty is the
  expected result, not a failed check. A screen that said "unverified" here would
  send them hunting for a problem that does not exist.
- "Blanked" is a claim about the Tag's Identity, not about the Tag being present.
  A blanked Tag and a Tag lifted off the Reader look identical in the read path,
  so the app says "the tag no longer presents an Identity" and offers a read
  rather than promising the chip is on the Reader.
- A Tag that already reads as empty cannot be blanked again through this path,
  because the guard cannot read it as a Tag. That is a refusal with an
  explanation, not a silent no-op.
- Whether a blanking write lands, and whether it triggers the T5577 lock bit, is
  still a hardware question. `src-tauri/examples/blankprobe.rs` is the repeatable
  probe; until it has run on a sacrificial blank, the write is implemented and
  its logic proven but not observed on a chip. Recording that gap is the point of
  the outcome model: nothing here claims more than the app saw.

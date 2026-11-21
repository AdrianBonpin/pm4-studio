# 15: Batch Clone

**What to build:** One source Identity is held and written to successive Blanks without re-reading the source, with each attempt reporting its own result and polling suspended for the duration. A refusal on one attempt does not abort the run. This is the several-people case: read once, then write as many Blanks as there are recipients.

**Blocked by:** 01, 03, 09

**Seams:**
- S4 Write guard with S3 Identity codec — catches per-attempt guard decisions and payload encoding; misses distinguishing two physically identical Blanks from each other.

**Tracker:** None
**Status:** done
**ADR:** docs/adr/0004-batch-clone-skips-and-counts-once.md

- [x] A source Identity is read once and reused across several writes.
- [x] Each attempt reports verified, unverified or refused separately.
- [x] A refusal on one attempt does not abort the run.
- [x] Write counts advance only for verified attempts.
- [x] Polling does not run while a batch is in progress.
- [x] The run never writes when the tag in position cannot be read.
- [x] The user is told that two identical Blanks cannot be distinguished, and that each attempt needs a fresh tag.
- [x] A batch attempt is observed on hardware.

## Implementation note — the identical-Tag hazard

ADR 0001 refuses a write when the Tag in the write position already presents the
target Identity. In a batch that case arrives **after write #1 succeeds**: the Tag
left on the Reader now presents the target. An inattentive loop then either
refuses everything after the first, or is tempted to bypass the guard "because we
know what is there" — which is the ordering that locked a T5577.

Settled in ADR 0004: the guard is **unchanged and re-evaluated per attempt**, and
the same-Identity refusal is reported as its own outcome, `skipped` — "this tag
already reads as `<id>`, nothing was written, it is either the original or one you
already wrote, put a fresh blank on". A skip maps to `Refused` for counting, so
`WriteOutcome::counts_as_confirmed_copy` stays the single counting rule and a skip
is structurally incapable of raising a count. Leaving a written Tag in place and
pressing again therefore reports a skip and changes nothing.

Where it lives:

- `src-tauri/src/batch.rs` — `BatchAttempt`, `BatchOutcome` (`skipped` plus the
  copy path's four), `BatchVerdict`, `BatchRun` (the held Identity, the per-attempt
  list, the counts), and `guarded_attempt`, which re-reads the Tag in the write
  position for every attempt via the single-clone path's own retry window. The
  guard decision is `write_guard::decide`; the payload is `lf_write`'s.
- `src-tauri/src/lib.rs` — `lf_clone_attempt(customer, data32)` writes one attempt
  and reports it; the library count recording is shared with `lf_write`
  (`record_write_count`), so both go through the one counting rule.
- `src/lib/batchClone.ts` — the held source reading, the per-kind counts, and the
  wording of each attempt. `IDENTICAL_BLANKS_LIMIT` and `FRESH_TAG_PER_ATTEMPT`
  are the two facts the UI states before the first attempt.
- `src/components/BatchClone.tsx` — the run: source shown once, per-attempt list,
  one write button per Blank. It holds `beginDeviceOperation()` for the whole run,
  so pollers skip every tick while a batch is open.
- `src/components/CloneWizard.tsx` — the batch is reached from the same source
  read as the single Clone ("Write it to several blanks"), so the original is
  tapped once either way.

The count is per verified attempt, not a claim about physical Tags: two identical
Blanks cannot be told apart, because the Reader reports an Identity and not a chip.
That is why the run says each attempt needs a fresh Tag.

## Hardware status — VERIFIED 2026-11-22

Two runs with real Tags on the Reader.

**Run 1 — the identical-Tag hazard, on hardware.** Source was a factory blank, so
the source Identity was the factory signature and every attempt compared equal:

```
attempts : 3 (0 verified, 3 skipped, 0 refused, 0 unknown, 0 failed)
copies   : 0
source   : 00 00 00 15 C9 (held for the whole run; never re-read)
message  : the tag on the reader already reads as 00 00 00 15 C9, so nothing was
           written. … Put a fresh blank tag on the reader for the next attempt.
```

Nothing was written and nothing was counted. This is the hazard the ticket was
written against, working on real firmware: the guard refuses the Tag that already
carries the target Identity rather than rewriting it, and the attempt is excluded
from the count instead of being reported as a refusal that failed.

**Run 2 — a real source and a real copy.** Source was the authored Tag
`55 00 84 82 12` (ticket 14), with factory blanks swapped in during the pauses:

```
source identity held: 55 00 84 82 12
attempt 1 : skipped    (the source Tag was still in place — refused, not written)
attempt 2 : skipped    (no swap had happened yet)
attempt 3 : verified   → copies: 1
attempts  : 3 (1 verified, 2 skipped, 0 refused, 0 unknown, 0 failed)
copies    : 1
```

What this establishes on hardware:

- the source Identity is read **once** and reused; it is never re-read per attempt
- a Tag already carrying the target Identity is **skipped, never written**, and is
  not counted — verified twice, in both runs
- only the **verified** attempt raised the count, to exactly 1
- the run did not abort after two skips; it continued to the third attempt
- `0x0073` **landed on a T5577 during a repeated sequence**

Still open: whether repeated writes to successive Blanks trigger the T5577 lock bit
of PROTOCOL open problem 7 (two Blanks were consumed here and both accepted the
write), and whether two physically identical Blanks can be told apart (they cannot
— the Reader reports an Identity, not a chip).

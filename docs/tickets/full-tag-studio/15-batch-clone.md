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
- [ ] A batch attempt is observed on hardware.

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

## Hardware status — UNVERIFIED

`cargo run --example batchprobe -- read` / `run [attempts] [pause-seconds]` in
`src-tauri/examples/` drives the shipping path. On 2026-11-21 the Reader opened and
answered — no `0xE00002C5`, no replug needed — but the 125 kHz field was empty
across three runs:

```
tag on reader: no tag latched
```

`run` therefore exited before any attempt ("no tag to read as the source: put the
Tag you want to copy on the reader"), so **no batch write was observed on a chip
and no Blank was consumed**. Same finding as ticket 13's blanking probe.

What that leaves open: whether `0x0073` lands during a repeated sequence, whether a
written Tag left in position reads back as the target and is skipped as designed on
real firmware, and whether repeated writes to successive Blanks trigger the T5577
lock bit of PROTOCOL open problem 7. Record the probe output here when a source Tag
and sacrificial Blanks are on the Reader.

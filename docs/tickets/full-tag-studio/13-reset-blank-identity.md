# 13: Reset — blank a Tag's Identity

**What to build:** A tag can be blanked so it carries no assigned Identity, behind a confirmation that states the write is permanent and that the tag may afterwards read as empty. The operation is described as blanking everywhere it appears, and never as a factory reset, because a factory state is not reachable over this protocol.

**Blocked by:** 01

**Seams:**
- S3 Identity codec with S4 Write guard — catches the neutral payload encoding and the refusal rules; misses whether a blanking write can lock a chip.

**Tracker:** None
**Status:** done

- [x] Blanking writes a neutral Identity and reports the outcome honestly.
- [x] The confirmation states the write is permanent and that the tag may read as empty afterwards.
- [x] The feature is labelled blanking, with no claim of factory restore or unlock.
- [x] The write is refused when no tag can be read first.
- [x] The user is told a blanked tag may be unusable for further writes.
- [ ] A blanking write is observed on hardware, on a sacrificial Blank.

## Implementation note — the outcome model ticket 01 handed over

Ticket 01 flagged that the codec treats `data32 == 0` as "no reading", so writing
the neutral Identity produces a Tag the read path reports as *no tag present*.
Read-back verification is therefore impossible by construction, and the honest
model is a distinct outcome rather than a failed check. See ADR 0003.

`WriteOutcome::Blanked` joins the existing four states, and
`write_outcome::classify_blank` judges the same evidence a copy does with the
success condition inverted: transmitted with no Identity in the re-read is
`blanked`; transmitted with an Identity still there is `failed`; transmitted with
no usable re-read is `unverified`. `counts_as_confirmed_copy` stays true for
`Verified` alone, so a blanking write cannot raise a Snapshot's count — asserted
directly in `library.rs`.

Presence is decoded separately (`identity::TagPresence`) because the combined
decoder folds "no Tag" and "a Tag with no Identity" into `None`. The guard
(`blank::decide`) refuses an unreadable reply, a Tag that already carries no
Identity, and a Tag presenting an Identity other than the one the user confirmed
— that last rule is why `lf_blank` takes the confirmed Identity back from the UI.

The confirmation copy is in `src/lib/blankTag.ts`, with its wording asserted by
tests: permanent, may read as empty (and that this is expected), may be unusable
for further writes, and an explicit denial that blanking is a factory reset or an
unlock.

## Hardware status — UNVERIFIED

`cargo run --example blankprobe -- read` / `-- blank` in `src-tauri/examples/`
exercises the shipping path. On 2026-11-21 the Reader opened and answered (wake,
HF poll, LF read all replied), but the 125 kHz field was empty across three runs
("no tag latched"), so **no blanking write has been observed on a chip** and no
Tag was consumed. What that leaves open: whether `0x0073` with the neutral payload
actually blanks a T5577, whether the Tag then reads as absent or as a present Tag
with an empty data field, and whether it triggers the T5577 lock bit of PROTOCOL
open problem 7. Record the probe output here when a sacrificial Blank is on the
Reader.

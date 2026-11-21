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
- [x] A blanking write is observed on hardware, on a sacrificial Blank.

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

## Hardware status — VERIFIED 2026-11-22

`cargo run --example blankprobe -- blank`, with a factory-blank T5577 on the Reader.

```
tag before   : tag present as 00 00 00 15 C9
confirmed    : 00 00 00 15 C9
guard        : Proceed
payload      : neutral identity (customer 0x00, data32 0x00000000)
sending      : 0x0073 …
attempt      : transmitted (NoIdentity)
outcome      : blanked

re-reading…
  after[0..4] : tag present, NO identity (data field empty)   (all 5 reads)
```

What this establishes:

- `0x0073` with the neutral 24-byte payload **transmits and blanks a T5577**. The
  earlier probe runs never got this far because the 125 kHz field was empty.
- The Tag afterwards reads as a **present Tag with an empty data field**, not as
  absent. That is the distinction ticket 01 flagged: `data32 == 0` decodes to
  "no reading", so the success condition here is "the Tag no longer presents an
  Identity", which is why the outcome is `blanked` and never `verified`.
- It held across 5 consecutive reads in the same session, and later across a
  separate process (the Tag still reported no identity when re-read alongside
  other tags).

Still open, and deliberately not tested: whether the Tag **still accepts
writes** after blanking. Testing that would consume it twice, and a blanked T5577
may refuse further writes. PROTOCOL open problem 7 (what sets the T5577 lock bit)
remains open. One earlier T5577 in this project is permanently locked.

Incidental finding recorded during this run: a factory-blank T5577 carries
`data32 = 0x000015C9` = **5577 decimal** — the chip model number — which the read
path reports as customer `0x00`, facility `0`, card `5577`. That is why every
factory blank reads identically and why batch attempts on blanks all compare
equal (see ticket 15).

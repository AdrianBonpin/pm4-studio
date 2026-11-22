# Hardware run — 2026-11-22

Run by the repository owner on the physical `NFC-PM4` (firmware `H00S07`) against
real tags, following `docs/superpowers/hardware-checklist-studio-redesign.md`.
Recorded here because ticket 20's criteria 3–7 cannot be answered by any test in
the repository.

Screenshots are in `screenshots/hardware-*.png`. The observations below are the
owner's, quoted from the runbook sign-off table; the adjudication of each item is
this document's own.

## What the run established

### Item 1 — MIFARE Classic 1K, 4-byte UID: **pass**

`screenshots/hardware-1-classic-1k-read.png`

UID `31 F3 0E 0A` — four bytes, no padding. Card type **MIFARE Classic 1K**,
capacity **1024 bytes**, ATQA **`04 00`**, SAK **`08`**, technologies
`ISO/IEC 14443-3A · MIFARE Classic`, NFC Forum type **none**, records
**not NDEF capable** with no message read attempted. Raw payload
`01 01 31 F3 0E 0A 30 53 30 37 00 00 04 04 00 08 01 10 00`.

That is the measured layout decoding as measured, on hardware, for the family the
old offsets got wrong. Note what the residue bytes held: `30 53 30 37` = ASCII
`0S07`, the tail of the firmware string `H00S07`. The decoder ignored it, which is
the behaviour `docs/PROTOCOL.md` now records with this capture as its evidence.

### Item 2 — NTAG, 7-byte UID: **pass**

The 7-byte UID `04 43 8A 01 22 09 03` decodes with its Records — visible in
`screenshots/hardware-3-copy-refused-empty-destination.png`, where Copy shows the
held source as `1 Record: URL https://devgo.studio · 17 bytes` against that UID,
with no raw fallback anywhere. A 7-byte UID presented as 7 bytes is exactly what
the old decoder could not do.

### Item 7 — the four symbols and the tuned gap: **pass**

Distinguishable by ear in every pair (`1 vs 2`, `2 vs 3`), the three-chirp
attention signal with its two-second LED usable in a loud room, and a
twenty-attempt batch still intelligible as it ran. That last one closes the spec's
open question about batch intelligibility past ten attempts.

The gap was then **tuned on hardware: `CHIRP_GAP_MS` 120 → 400**. The nominal
120 ms ran two chirps together, so "needs you" sounded like one longer beep and
could not be told from "done" — the alphabet's whole premise. 400 ms separates
one, two and three cleanly. The constant, its test and the specification's nominal
figure now carry the measured value.

## What the run did not establish

### Item 3 — Copy between two tags: **blocked, not failed**

`screenshots/hardware-3-copy-refused-empty-destination.png`

Copy refused a destination it had read perfectly well:

> Not copied: the destination's message could not be read, so nothing is replaced.
> The tag is NDEF formatted and holds an empty message (an NDEF TLV of length
> zero), so it has zero Records and there is nothing to load.

The app states the tag *is* NDEF formatted with a zero-length TLV — a successful
read — and then refuses it as unreadable. That is
`copy-refuses-a-destination-that-holds-no-message.md`, already recorded from the
browser pass. An empty tag is the ordinary destination for a copy, so the flow
could not be exercised against a realistic second tag. **Copy's read-back
verification has still never run on hardware.** It needs a destination that
already holds a message until that ticket lands.

Also visible here: the bottom-right message covers the inline notice's text. That
is observation O1 from `08-findings.md` — a corner message overlapping a control —
reproduced on hardware.

### Item 4 — oversize destination refused: **not run**

No second tag of insufficient capacity was available. Unverified.

### Item 5 — Reset twice: **half observed, and a new finding**

> **Read with hindsight (2026-11-22, after the run).** The operation this item
> exercised was a single destructive write called **Reset**. It has since split into
> **Clear** (writes a non-zero placeholder; the tag stays usable) and **Destroy**
> (the all-zero write this item measured). The findings below are unchanged — they
> are what Destroy does — and the runbook's item 5 has been rewritten for both
> operations. This section is a record of what was observed, not of what the app
> now offers.

`screenshots/hardware-5-reset-reported-blanked.png`

The first half is **pass**: the write reported *Blanked* — not verified, not a copy
— with "No copy was recorded: blanking destroys an Identity rather than copying
one", which is ticket 12's honesty requirement holding on hardware.

The second half is **not observed**. The expected sequence is: put the same tag
back, reset it again, and hear the attention symbol while the app says the tag
will not accept writes. What the owner reported instead:

> after blanking an empty tag, refuses to be read or written anymore (lost)

So the tag stopped answering before the refusal could be reached. **The "will not
accept writes" outcome — ticket 12's central user-visible claim, with its
three-chirp signal and two-second LED — has still never been seen on hardware.**
That is recorded as its own follow-up, because the observation may also mean the
blanking write can leave a tag unreadable, which is worse than the caveat the app
prints ("it may refuse further writes … it will probably read as empty").

**Correction, later the same day.** Two things here were wrong, and both are now
fixed in the app rather than only in this record.

1. The tag was never unreadable. `cargo run --example blankprobe -- read` reports
   `tag present, NO identity (data field empty)`: the chip latches and modulates,
   with an empty data field. The app called that "no tag", because the combined
   read folds "no Tag" and "a Tag with no Identity" into `None`, so its write
guard refused every write to a Tag it had itself blanked. `write_guard::decide`
   now takes the presence-aware reading, and a Tag that is present with no
   Identity is a legal write position.
2. The expectation above — second Reset → *will not accept writes* — could never
   have happened. A second Reset of a freshly blanked Tag is refused before
   anything is sent, because there is nothing left to blank
   (`BlankDecision::RefuseNothingToBlank`, reported as `Refused`). *Will not
   accept writes* requires a blanking write that **was** sent and whose re-read
   still found an Identity. The runbook and the follow-up ticket now keep the two
   apart.

**Later measurement of the same tag, after the fix.** A write of a non-zero
Identity is transmitted successfully and the Tag never takes it: two attempts,
including one after lifting the Tag off the Reader and re-presenting it to force
a re-latch. The Tag still latches and reads as carrying no Identity, and accepts
no data. So writing the all-zero data field appears to have left this T5577
permanently refusing writes. What blanking *should* write is therefore an open
product question, not a settled decision — recorded in the follow-up ticket,
and not changed by this branch.

### Item 6 — clone, batch, authored Identity: **unconfirmed**

Signed off as "works?" — which is not an observation. All three report their own
outcomes in the automated suite, but nothing on hardware confirmed which symbol
each produced. Unverified.

## Effect on ticket 20

Criteria 3, 4 and 5–7 of ticket 20 are **not** ticked. Criterion 4 got no
observation, and criterion 5's second half — the entire reason ticket 12 exists —
did not happen on hardware. A test suite asserting a refusal outcome is not the
same evidence as hearing it, which is what the checklist was written to
distinguish. Criterion 5's *first* half did happen and is unaffected; its second
half was also mis-specified, as the correction under item 5 records.

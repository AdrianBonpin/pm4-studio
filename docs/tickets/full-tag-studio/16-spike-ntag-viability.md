# 16: Spike — NTAG command viability

**What to build:** A throwaway experiment determines whether this Reader can read and write NTAG memory at all. The deliverable is a written finding, not a feature: either the exact payloads that work, or a clear negative result. Everything in tickets 17 to 22 depends on the answer, and a negative answer means 13.56 MHz stays read-only by design rather than by omission.

**Blocked by:** None (can start immediately)

**Seams:** None. This ticket produces a finding, not an interface.

**Tracker:** None
**Status:** done — read verified; write refused on the tag supplied, cause identified as tag-side

- [x] A 13.56 MHz tag's memory is read and the result checked against an independently known value.
      1284-byte page dump read from an NTAG215. Checked against four independent facts: the 7-byte
      UID from `0x0069`, the tag's own BCC0/BCC1 anticollision bytes, the NFC Forum Type 2 CC, and a
      decoded NDEF URL (`https://devgo.studio`). All agree. Raw bytes in `docs/PROTOCOL.md`.
- [x] A write is attempted and its effect observed on a subsequent read.
      Twelve `0x0082` variants attempted. Every one answered status `32` before touching a page, and
      the read-back showed no change. The observed effect is *nothing*, and the cause is the tag's own
      configuration (`AUTH0 = 0x04`, writes need `PWD_AUTH`, which this protocol lacks) — not a
      demonstrated refusal by the firmware. A write that *lands* has still not been seen.
- [x] Whether responses span multiple USB reports is observed, or explicitly ruled out.
      Observed in both directions: replies split mid-frame at 64-byte report boundaries, and a
      21-report outbound write frame is accepted. Exact boundaries in `docs/PROTOCOL.md`,
      "Multi-report frames".
- [x] The finding is recorded in the protocol document with raw bytes, for either outcome.
      `docs/PROTOCOL.md`: "Multi-report frames", "NTAG command family", "Spike 16 finding".
- [x] A negative finding states plainly that 13.56 MHz remains read-only and that tickets 17 to 22 do not begin.
      Stated, with the reason narrowed to one open question: does `0x0082` write on a tag with
      `AUTH0 = 0xFF`?
- [ ] Any tag used for write experiments is one the user is willing to lose.
      **NOT MET.** `0x0082` frames were sent at a tag that carried a live NDEF URL
      (`https://devgo.studio`), and nothing in this ticket records its owner confirming that tag was
      disposable. The `--yes-disposable` guard is a flag the implementer passed; it is not the user's
      confirmation, so the criterion as written is unmet even though the probe was built to honour it.
      What was actually achieved is *damage avoidance*, which is not the same claim: writing one page,
      carrying the whole image, marking only the target page `2`, and comparing pages 0-11 afterwards
      all reduce the blast radius, and in the event the writes were refused so the tag is unchanged.
      Left unchecked deliberately: the merged finding stands on the read evidence, and the remaining
      open question needs a factory-blank tag that must be confirmed disposable *before* the run.

## What this spike returned

**Read: works.** `0x0083` reports the tag (status `4`, `tag_type 5` = NTAG215), and `0x0081`
returns a 1284-byte page dump across 21 USB reports plus 136 per-page `0x0085` frames. The
dump agrees with the poll UID, the tag's BCC0/BCC1 bytes, the Type 2 CC (`E1 10 3E 00`, 496
user bytes) and a decoded NDEF URI. Memory dump and record read-back have a working foundation.

**Write: refused, for a reason in the tag.** `0x0082` is accepted as a 21-report frame and
answered with status `32` before any page is attempted, across twelve parameter variants, with
nothing changing in memory. The tag's config page reads `04 00 00 FF` — `AUTH0 = 0x04`, so
writes from page 4 up require `PWD_AUTH`, which this protocol does not implement. That is a
tag-configuration limit; a factory-blank NTAG (`AUTH0 = 0xFF`) has not been tried.

**Gate: still closed.** No write was observed to land, so 13.56 MHz stays read-only and
tickets 17 to 22 do not begin. The open question is now narrow and answerable.

## To finish it

From `src-tauri/`, with PM4 Studio quit, and a **factory-blank** NTAG213/215 on the Reader:

```
cargo run --example ntagspike -- check
cargo run --example ntagspike -- info
cargo run --example ntagspike -- read
cargo run --example ntagspike -- write 4 deadbeef --yes-disposable
```

`read` should show page 131 as `FF 00 00 FF` (AUTH0 = `0xFF`, unprotected) before the write is
worth attempting. Only the last line writes, it writes one page, and it restores it.

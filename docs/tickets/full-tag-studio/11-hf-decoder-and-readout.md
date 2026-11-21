# 11: HF decoder and decode-aware readout

**What to build:** Tapping a tag shows the UID, and when the ATQA/SAK pair resolves, also the card family, technologies, capacity where known, and whether the tag is NDEF formatted. When the pair does not resolve, or the response is not the expected shape, the app shows raw bytes and says why rather than inventing values. Every reading keeps its raw bytes available.

**Blocked by:** 10

**Seams:**
- S5 HF decoder — catches offset handling, ATQA byte order, UID extraction and length-mismatch fallback; misses **whether the offsets are correct**, which only a real capture can settle.

**Tracker:** None
**Status:** done

- [x] A tap shows a UID for any tag that responds.
- [x] A resolvable tag shows family and technologies.
- [x] A response whose length differs from the expected shape shows raw bytes and no decoded fields.
- [x] An unknown ATQA/SAK pair shows raw bytes and no family.
- [x] A tag whose UID is not the expected width shows raw bytes and no UID split.
- [x] Raw bytes remain available for every reading.
- [x] Decoded values are marked provisional until ticket 12 confirms the offsets.

**Implementation note — UID width.** A Tag whose ATQA announces a 7- or 10-byte
UID (NTAG21x, MIFARE DESFire, 7-byte MIFARE Classic) reports raw bytes only. The
hypothesised reply has a 4-byte UID field and nowhere else captured to look, so
showing those bytes as "the UID" would present a fragment as the whole value.
The spec leaves wider UIDs as raw ("such tags show raw"), and the readout states
the reason rather than dropping the reading. Tags with a 4-byte UID — including
MIFARE Classic 1K/4K — decode fully.

**Merge verification — the one real capture.** Spike 16 captured a latched
NTAG215 on real hardware (`docs/PROTOCOL.md`, "`0x0069` payloads, for the
record"): `01 01 04 43 8A 01 22 09 03 1D 00 20 07 44 00 00 02 00 00`. Run through
this decoder that reply is 19 bytes and latched, so the length and flag checks
pass, but the hypothesised ATQA/SAK offsets read `00 00` / `00`, which resolves to
nothing — the readout therefore falls back to raw bytes with reason
`unknown-card-type`, naming no family, no capacity and no technologies. That is
the honest outcome and it agrees with spike 16's own conclusion that this tail
"does not look like ATQA and SAK".

Consequence worth stating plainly: with a 7-byte UID the UID sits at offsets
2..9, not 2..6, so **the one physical tag available shows raw bytes and no UID**.
Criterion 1 ("a tap shows a UID for any tag that responds") therefore holds only
within the spec's scope — 4-byte-UID tags. 7- and 10-byte UIDs stay out of scope
until they are captured; see spec non-goals and the assumption table.

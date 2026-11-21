# 06: Decode the measured reply layout, and stop claiming unresolved families

**What to build:** A tag reads as the Card type it actually is. The reply layout was measured against two real tag families and the previous offsets were wrong by one byte; with the correction the captured Tag from a school identity card reads as MIFARE Classic 1K instead of matching nothing, and a 7-byte-UID tag keeps its whole UID instead of having it guessed at and padded. The provisional badge and the section explaining it disappear, because the offsets are no longer a guess.

**Blocked by:** None (can start immediately)

**Seams:**
- HF decoder — catches an offset regression, ATQA byte order, UID-width handling from the reply's own length byte, residue bytes presented as content, and every raw fallback; misses a future firmware revision changing the layout, which only a fresh capture settles.
- Card type resolver (existing) — catches a table error and an unassigned pair returning nothing; misses nothing currently covered.

The two captured payloads recorded in the spec are the expected values, and they are independent of the implementation: they came off hardware and their ATQA/SAK values are the published ones for those families.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/13
**Status:** done

- [x] The real MIFARE Classic 1K capture decodes as MIFARE Classic 1K with UID `31 F3 0E 0A`, ATQA `0x0004`, SAK `0x08` and capacity 1024.
- [x] The real NTAG215 capture decodes with its full 7-byte UID `04 43 8A 01 22 09 03`, ATQA `0x0044`, SAK `0x00`, and its capacity marked unavailable rather than guessed.
- [x] ATQA is read from the corrected positions and reported in transmission order; SAK from its own corrected position.
- [x] UID width comes from the reply's own length byte. Widths of 4, 7 and 10 bytes are accepted; any other width is its own distinct refusal, never a truncated or zero-padded UID.
- [x] No width is inferred from ATQA bits anywhere. The padded-UID failure that made a four-byte card report a seven-byte serial cannot recur.
- [x] The residue bytes between the UID and the length byte are never presented as UID or as content.
- [x] A pair that no published table assigns still shows raw bytes with a reason and no family, capacity or technologies.
- [x] Neither a provisional badge nor a provisional explanation section exists anywhere in the interface.
- [x] The memory dump does not name a tag family it has not resolved. A tag whose memory cannot be read says so and names nothing.
- [x] The two captures are fixtures, and every existing synthetic 13.56 MHz fixture that encoded the refuted layout is corrected or removed.
- [x] The protocol document's layout table is corrected, and the bytes it still cannot explain remain documented as unexplained.
- [x] A reply of an unexpected length still falls back to raw with its own reason.

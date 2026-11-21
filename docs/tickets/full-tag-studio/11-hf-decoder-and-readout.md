# 11: HF decoder and decode-aware readout

**What to build:** Tapping a tag shows the UID, and when the ATQA/SAK pair resolves, also the card family, technologies, capacity where known, and whether the tag is NDEF formatted. When the pair does not resolve, or the response is not the expected shape, the app shows raw bytes and says why rather than inventing values. Every reading keeps its raw bytes available.

**Blocked by:** 10

**Seams:**
- S5 HF decoder — catches offset handling, ATQA byte order, UID extraction and length-mismatch fallback; misses **whether the offsets are correct**, which only a real capture can settle.

**Tracker:** None
**Status:** ready

- [ ] A tap shows a UID for any tag that responds.
- [ ] A resolvable tag shows family and technologies.
- [ ] A response whose length differs from the expected shape shows raw bytes and no decoded fields.
- [ ] An unknown ATQA/SAK pair shows raw bytes and no family.
- [ ] A tag whose UID is not the expected width shows raw bytes and no UID split.
- [ ] Raw bytes remain available for every reading.
- [ ] Decoded values are marked provisional until ticket 12 confirms the offsets.

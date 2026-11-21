# 14: Author an Identity by hand

**What to build:** An Identity is entered as customer, facility and card values, or as raw five-byte hex, validated against the valid ranges, shown before writing, written to a Blank, and optionally kept as a Snapshot in one action. This is what turns the app from a duplicator into a writer.

**Blocked by:** 01, 03

**Seams:**
- S3 Identity codec with S4 Write guard — catches input-to-Identity conversion, validation ranges and the guard; misses whether the device accepts the result.

**Tracker:** None
**Status:** ready

- [ ] Customer, facility and card-number input produces the same Identity the decoder reports for those values.
- [ ] Raw five-byte hex entry is accepted and validated.
- [ ] Out-of-range entries are rejected with the valid range shown.
- [ ] The exact Identity to be written is shown before the write is sent.
- [ ] A successful write can be saved as a Snapshot in one action.
- [ ] The write is refused when no tag can be read first.

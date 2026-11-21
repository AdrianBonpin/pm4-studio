# 18: Write a Draft to a Tag

**What to build:** A Draft's Records are written to a tag as one complete message, read back, and the outcome reported as verified, unverified or refused. The confirmation names what is being replaced, or states that the tag appears empty. There is no in-place append: a write replaces the message.

**Blocked by:** 07, 16, 17

**Seams:**
- S7 NDEF codec with S8 Library store — catches the encode-then-verify round trip and outcome classification; misses real tag behaviour beyond the write itself.

**Tracker:** None
**Status:** ready

- [ ] Writing a Draft lands its Records and a read-back returns them.
- [ ] The confirmation names the existing content being replaced, or states the tag appears empty.
- [ ] A write that transmits but cannot be read back is reported as unverified with instructions, not as a failure.
- [ ] A write that cannot transmit is reported as failed.
- [ ] An empty Draft is refused before anything is sent.
- [ ] A Draft larger than the tag's capacity is refused before anything is sent.
- [ ] Polling is suspended for the duration of the write.

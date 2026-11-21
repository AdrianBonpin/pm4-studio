# 17: Report stream reassembler

**What to build:** Responses that span several USB reports are reconstructed into complete frames instead of being truncated, so that long tag responses can be parsed at all. Single-report responses continue to behave exactly as before.

**Blocked by:** 16

**Seams:**
- S2 Report stream reassembler — catches multi-report reconstruction, partial frames and desynchronisation; misses whether the hardware really emits responses this way, which ticket 16 observed.

**Tracker:** None
**Status:** ready

- [ ] A response delivered across several reports is reconstructed into one frame.
- [ ] A frame split at each possible report boundary still parses.
- [ ] A stream containing an unknown or malformed segment resynchronises instead of wedging.
- [ ] Single-report responses behave exactly as they do today.
- [ ] Every previously captured frame still parses identically.
- [ ] A declared length larger than the bytes actually received is reported as an error rather than silently truncated.

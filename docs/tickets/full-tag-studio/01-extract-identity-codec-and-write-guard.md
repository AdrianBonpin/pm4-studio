# 01: Extract the Identity codec and write guard

**What to build:** The 125 kHz read and clone paths keep behaving exactly as they do today, but the two pieces of logic that carry the safety burden become standalone decisions that can be exercised with no Reader plugged in. Turning a poll payload into an Identity, and deciding whether a write may proceed at all, both become testable in isolation. Nothing visible changes; what changes is that the fail-closed rule recorded in ADR 0001 becomes provable rather than assumed.

**Blocked by:** None (can start immediately)

**Seams:**
- S3 Identity codec — catches facility/card arithmetic, the four-byte shift between read and write layouts, endianness, and the 24-byte write length; misses whether the device accepts a payload.
- S4 Write guard — catches refuse-when-unreadable and refuse-when-tag-already-presents-target; misses whether a write actually locks a chip.

**Tracker:** None
**Status:** ready

- [ ] Decoding a stored real capture yields the same Identity, facility and card values as the app reports today.
- [ ] Encoding an Identity produces exactly the 24 bytes previously accepted by the device, proven byte-for-byte against a stored real frame.
- [ ] The guard refuses when no tag can be read, and refuses when the tag already presents the target Identity, both provable with no hardware attached.
- [ ] An encode request for an out-of-range Identity is rejected rather than silently truncated.
- [ ] A clone performed on the physical Reader still writes and verifies exactly as before.

# 13: Reset — blank a Tag's Identity

**What to build:** A tag can be blanked so it carries no assigned Identity, behind a confirmation that states the write is permanent and that the tag may afterwards read as empty. The operation is described as blanking everywhere it appears, and never as a factory reset, because a factory state is not reachable over this protocol.

**Blocked by:** 01

**Seams:**
- S3 Identity codec with S4 Write guard — catches the neutral payload encoding and the refusal rules; misses whether a blanking write can lock a chip.

**Tracker:** None
**Status:** ready

- [ ] Blanking writes a neutral Identity and reports the outcome honestly.
- [ ] The confirmation states the write is permanent and that the tag may read as empty afterwards.
- [ ] The feature is labelled blanking, with no claim of factory restore or unlock.
- [ ] The write is refused when no tag can be read first.
- [ ] The user is told a blanked tag may be unusable for further writes.

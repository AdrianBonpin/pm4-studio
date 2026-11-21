# 15: Batch Clone

**What to build:** One source Identity is held and written to successive Blanks without re-reading the source, with each attempt reporting its own result and polling suspended for the duration. A refusal on one attempt does not abort the run. This is the several-people case: read once, then write as many Blanks as there are recipients.

**Blocked by:** 01, 03, 09

**Seams:**
- S4 Write guard with S3 Identity codec — catches per-attempt guard decisions and payload encoding; misses distinguishing two physically identical Blanks from each other.

**Tracker:** None
**Status:** ready

- [ ] A source Identity is read once and reused across several writes.
- [ ] Each attempt reports verified, unverified or refused separately.
- [ ] A refusal on one attempt does not abort the run.
- [ ] Write counts advance only for verified attempts.
- [ ] Polling does not run while a batch is in progress.
- [ ] The run never writes when the tag in position cannot be read.
- [ ] The user is told that two identical Blanks cannot be distinguished, and that each attempt needs a fresh tag.

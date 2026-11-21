# 20: Erase a Tag's NDEF

**What to build:** A tag's NDEF content is cleared so the tag can be reused, behind a confirmation naming what will be lost. The tag remains a tag: erasing clears content, it does not destroy the tag or change its format.

**Blocked by:** 16, 17

**Seams:**
- S7 NDEF codec with S8 Library store — catches the erase payload and outcome classification; misses tags whose format prevents erasure.

**Tracker:** None
**Status:** ready

- [ ] Erasing clears NDEF content; a subsequent read shows the tag present with no Records.
- [ ] Erase requires confirmation naming what will be lost.
- [ ] Erasing a tag that cannot be read first is refused.
- [ ] A failed erase reports failure and leaves the tag readable.
- [ ] Erase is not presented as a way to make a tag read-only or to remove password protection.

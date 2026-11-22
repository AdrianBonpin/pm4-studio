# 15: Copy a whole NDEF message between 13.56 MHz tags

**What to build:** Duplicating a message is one guided flow that protects the tag it is reading from. You read the source, take it off, put the destination on, see exactly what is about to be replaced, and the app refuses before writing anything if the message will not fit or the destination will not take it.

**Blocked by:** 08, 14

**Seams:**
- Copy guard (pure) — catches a source that was not removed, an unreadable or identical destination, an oversize message, and an undetermined capacity treated as sufficient; misses chip-level lock or password state.
- NDEF codec (existing) — catches a message that decodes to the wrong Records; misses how a particular tag encodes it.
- Signal vocabulary (existing) — catches a copy result that is never signalled or signalled with the wrong symbol; misses audibility.

This is Copy, not Clone. A Clone is confirmed by comparing an Identity; a Copy by comparing a whole message. The two verify differently and keep different names.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/25
**Status:** done

- [x] The flow reads the source message and holds it, then requires the source to be removed, observing that no tag is latched before it will proceed.
- [x] It refuses to continue while the source is still readable in the write position.
- [x] It reads the destination's current message and shows what will be replaced, with its size, before anything is written.
- [x] It refuses before writing when the destination's known capacity cannot hold the message, and names both numbers.
- [x] When the destination's capacity cannot be determined, it states that the fit is unknown and proceeds only on an explicit acknowledgement. It neither refuses outright nor assumes a fit.
- [x] It writes, reads the message back, and compares the decoded Records in order together with the total encoded length.
- [x] A destination that legitimately re-encoded an equal message reports success, not failure.
- [x] Refusals name which condition fired. Where read-only and password protected cannot be distinguished, it reports the merged condition and says it cannot tell them apart rather than picking one.
- [x] Removing the source and placing no destination leaves the source intact and reports the state plainly.
- [x] The result reaches the audible symbol: done for a verified copy, needs-you for an unverified one, attention for a refusal.
- [x] No 13.56 MHz write path other than this one is reachable without a confirmation naming what will be replaced.

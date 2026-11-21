# 11: 125 kHz becomes a mode-switched workspace

**What to build:** The 125 kHz page shows one operation at a time in the order the work actually happens — Read, Write, Reset, Clone, Batch — so reaching the fifth no longer means scrolling past four. The section that only pointed at another page is gone.

**Blocked by:** 02, 03

**Seams:**
- Outcome seam (existing) — catches a re-hosted operation that stopped reporting; misses nothing currently covered.
- Confirmation gates (existing) — catches an operation whose confirmation was lost in the move; misses nothing currently covered.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/19
**Status:** ready

- [ ] The page offers Read, Write, Reset, Clone and Batch in that order, with one visible at a time.
- [ ] Read is the default mode, because it is both the base capability and the precondition every write depends on.
- [ ] Every mode is reachable in one click and needs no scrolling at the minimum window size.
- [ ] The mode you were last in is restored when you return to the page within a session.
- [ ] Read shows the Identity large, the decoded facility and card values, and the raw payload available but collapsed.
- [ ] Reading a tag can still be saved to the library in one action, and the save reports its outcome.
- [ ] Write still accepts customer, facility and card entry or a raw five-byte value, and out-of-range entry is still refused with the valid range shown, inline.
- [ ] The section that only pointed at the Library destination is removed.
- [ ] Every safety gate the operations had before the move still fires after it: the read-before-write refusal, the already-presents-this-Identity refusal, and the confirmation naming what will be replaced.

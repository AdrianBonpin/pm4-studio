# 13: Clone and Batch report their own outcomes

**What to build:** Every clone attempt, including the ones that fail, is heard and seen. A refusal tells you whether the reader could not read the tag in front of it or whether that tag already presents the Identity you are writing — two problems with two different fixes that currently look identical.

**Blocked by:** 04, 11

**Seams:**
- Outcome seam (existing) — catches an attempt that reports nothing; misses whether the chip accepted the write.
- Write outcome classification (existing) — catches verified, unverified and refused collapsing into one another; misses why the chip refused.
- Signal vocabulary (existing) — catches a failed attempt that sounds like a success; misses audibility.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/24
**Status:** done

- [x] Reading the source and reading the destination each report their own outcome while the wizard waits for you.
- [x] A write that verifies reports done; a write whose read-back cannot confirm it reports needs-you and is never presented as failure.
- [x] A refusal names which condition fired: nothing readable in the write position, or the tag already presents the Identity being written.
- [x] Batch reports each attempt separately, and a skipped attempt, a refused attempt and a verified attempt are three distinguishable results.
- [x] Batch signals per attempt, so which fob worked is audible without reading the list.
- [x] A batch run counts a confirmed copy once per verified write and never for a skip, a refusal or an unverified write.
- [x] Background polling produces no signal at any point during a run.
- [x] No new path reaches the beeper except through the outcome seam.

# 17: Contract: remove the legacy chirp prop

**What to build:** There is exactly one way for anything in the app to make a sound, so an operation that forgets to report itself is a structural gap rather than a silence nobody notices. The second reporting path that the outcome seam was grown beside is deleted.

**Blocked by:** 13, 15, 16

**Seams:**
- Outcome seam (existing) — catches an operation with no outcome; this ticket is what makes that impossible rather than merely unlikely.
- Signal vocabulary (existing) — catches a symbol that disagrees with the outcome; misses audibility.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/27
**Status:** ready

- [ ] No component receives a callback that makes a sound.
- [ ] The beeper is reachable only through the outcome seam.
- [ ] The compatibility path that let unwired call sites keep working is deleted, not left dormant.
- [ ] Every operation listed as reporting in the specification's signal table reports through the seam, and a test enumerates that list so a newly added operation without a report fails rather than passes.
- [ ] Removing the report from any one of those operations fails at least one test.
- [ ] The sound and the message for a given outcome still cannot disagree after the deletion.

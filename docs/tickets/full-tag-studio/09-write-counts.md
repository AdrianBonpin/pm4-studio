# 09: Write counts on Snapshots

**What to build:** Each Snapshot shows how many confirmed copies of it exist. The count rises only for a write whose read-back verified, and never for a refusal, a transmission failure, or an outcome that could not be confirmed.

**Blocked by:** 03

**Seams:**
- S8 Library store with S4 Write guard — catches the counting rules and their persistence; misses nothing new.

**Tracker:** None
**Status:** ready

- [ ] A verified write increments the Snapshot's count.
- [ ] A refused write does not increment it.
- [ ] A write that transmitted but could not be read back does not increment it.
- [ ] The count survives restart.
- [ ] The count is presented as confirmed copies, not as attempts.

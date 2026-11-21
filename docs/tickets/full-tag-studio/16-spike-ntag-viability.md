# 16: Spike — NTAG command viability

**What to build:** A throwaway experiment determines whether this Reader can read and write NTAG memory at all. The deliverable is a written finding, not a feature: either the exact payloads that work, or a clear negative result. Everything in tickets 17 to 22 depends on the answer, and a negative answer means 13.56 MHz stays read-only by design rather than by omission.

**Blocked by:** None (can start immediately)

**Seams:** None. This ticket produces a finding, not an interface.

**Tracker:** None
**Status:** ready

- [ ] A 13.56 MHz tag's memory is read and the result checked against an independently known value.
- [ ] A write is attempted and its effect observed on a subsequent read.
- [ ] Whether responses span multiple USB reports is observed, or explicitly ruled out.
- [ ] The finding is recorded in the protocol document with raw bytes, for either outcome.
- [ ] A negative finding states plainly that 13.56 MHz remains read-only and that tickets 17 to 22 do not begin.
- [ ] Any tag used for write experiments is one the user is willing to lose.

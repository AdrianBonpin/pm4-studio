# 08: One Read on 13.56 MHz fetches the identity and the message

**What to build:** One action answers the whole question. A tap reports the UID, the card type, the capacity, whether the tag is NDEF formatted, and the Records as rows. When part of it could not be fetched, the readout shows what it did get and says why the rest is missing — it never looks complete when it is not.

**Blocked by:** 06

**Seams:**
- HF decoder (existing, corrected in 06) — catches the identity half; misses the message half entirely.
- NDEF codec (existing) — catches a Record that decodes to the wrong kind or fields; misses how the tag actually held it.
- Outcome seam (existing) — catches an operation that reports nothing; misses whether the two device transactions both happened.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/15
**Status:** ready

- [ ] One action performs the poll and the message read and presents a single readout.
- [ ] The readout lists the Records as rows carrying kind, a short summary, encoded size and validity, in the tag's own order.
- [ ] A tag whose family is not NDEF capable says so and offers no message read.
- [ ] A reply that cannot be decoded shows raw bytes and the reason, and offers no message read.
- [ ] When the poll succeeds and the message read fails, the identity it did get is shown together with the reason the Records are absent. Nothing is hidden and nothing is dressed up as complete.
- [ ] Capacity comes from the published table where the pair determines it, otherwise from the tag's Capability Container, otherwise it is stated as not determined.
- [ ] NDEF status comes from the message or the container, never from the poll.
- [ ] A message read of a different tag never attaches itself to this reading.
- [ ] The whole operation reports exactly one outcome, and the audible symbol distinguishes "read fully" from "read, but check this".

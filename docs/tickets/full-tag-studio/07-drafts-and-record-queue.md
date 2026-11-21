# 07: Drafts and the NDEF record queue

**What to build:** A Draft is created by name, Records are added, reordered, edited and deleted, and the Draft is saved and survives restart. Drafts appear in their own section, structurally separate from Snapshots, so "my tags" always means tags. Text and URL Records work end to end, establishing both the codec and the editor pattern the remaining types will follow.

**Blocked by:** 03

**Seams:**
- S7 NDEF codec — catches TNF and length correctness and round-trip for the supported types; misses real tag behaviour.

**Tracker:** None
**Status:** done

- [x] A Draft can be created, named, saved, and survives restart.
- [x] Drafts appear in a section distinct from Snapshots.
- [x] Text and URL Records can be added, edited, reordered and deleted.
- [x] Encoding a Text and a URL Record produces a valid NDEF message, proven against independently written expected bytes.
- [x] Decoding that message returns the same Records in the same order.
- [x] An empty Draft explains what it is for.
- [x] A Draft is never presented as being attached to a tag.

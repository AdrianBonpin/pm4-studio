# 22: Load a Tag's Records into a Draft

**What to build:** Reading a tag that already holds Records loads them into a Draft, which can be edited and written back as a whole message. This is the read-edit-rewrite loop, and it is the only way content is modified — there is no in-place append.

**Blocked by:** 07, 19

**Seams:**
- S7 NDEF codec — catches decoding of real tag-formatted messages and order preservation; misses tag-specific quirks in how content was originally written.

**Tracker:** None
**Status:** ready

- [ ] Reading a tag with Records produces a Draft containing the same Records in the same order.
- [ ] The Draft can be edited and written back whole.
- [ ] A tag whose Records cannot be decoded falls back to a raw view rather than a half-populated Draft.
- [ ] Loading into a Draft never modifies the tag by itself.
- [ ] Loading a tag that already exists as a Snapshot does not overwrite that Snapshot.

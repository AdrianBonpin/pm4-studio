# 19: Read memory dump and export

**What to build:** A tag's memory is read as a page or block dump showing offsets, hex and an ASCII view, and exported to a file the user chooses. This is the diagnostic floor for tags the decoder does not recognise.

**Blocked by:** 16, 17

**Seams:**
- S2 Report stream reassembler with the dump formatter — catches reassembly and dump layout; misses tag semantics, which the dump deliberately does not interpret.

**Tracker:** None
**Status:** ready

- [ ] A dump shows offsets, hex and ASCII.
- [ ] The dump matches an independently known value for at least one tag.
- [ ] The dump exports to a file the user chooses.
- [ ] Reading memory from a tag that does not respond reports failure without wedging the app.
- [ ] The dump states which tag it came from, so two exports can be told apart.

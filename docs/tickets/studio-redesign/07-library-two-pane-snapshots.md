# 07: Library becomes a two-pane list-and-detail for Snapshots

**What to build:** Choosing something in Library shows it beside the list instead of pushing it below the rest of the page. Renaming, adding a note, deleting and writing back to a tag all happen in the detail pane, and the list stays put.

**Blocked by:** 03

**Seams:**
- Confirmation gates (existing) — catches a delete that stopped asking; misses nothing currently covered.
- Library store (existing) — catches a rename or note edit that does not persist; misses nothing currently covered.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/18
**Status:** ready

- [ ] The list sits beside the selected Snapshot rather than above it, and selecting one does not scroll or reflow anything.
- [ ] Search and sort appear only when there is more than one Snapshot.
- [ ] Rename, note edit, delete-with-confirmation, and write-to-a-tag all work from the detail pane.
- [ ] An empty library and a library with nothing selected are two different, deliberate states.
- [ ] The list stays interactive at five hundred Snapshots.
- [ ] The detail pane never shows a Records area for a 125 kHz Snapshot, and shows `none` rather than `loading` for a 13.56 MHz Snapshot until that field exists.
- [ ] The unwritable-library condition and the migration warning remain visible and continue to disable the controls that write.
- [ ] Every control keeps its accessible name and its danger variant where it has one, so the existing confirmation tests still pass unchanged.

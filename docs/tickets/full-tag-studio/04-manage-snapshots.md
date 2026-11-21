# 04: Manage Snapshots — rename, note, delete, search, sort

**What to build:** A Snapshot can be renamed, given a note, and deleted behind a confirmation. The library can be searched and sorted so it stays usable once it holds several hundred entries.

**Blocked by:** 03

**Seams:**
- S8 Library store — catches mutation persistence and conflict-free updates; misses UI state.

**Tracker:** None
**Status:** ready

- [ ] Renaming a Snapshot persists across restart.
- [ ] A note can be attached to a Snapshot and persists across restart.
- [ ] Deleting requires confirmation and is permanent.
- [ ] Search matches on name, Identity and UID.
- [ ] Sorting by name and by captured time both work.
- [ ] A library of 500 Snapshots remains interactive while filtering.
- [ ] Cancelling an edit leaves the stored Snapshot unchanged.

# 04: Manage Snapshots — rename, note, delete, search, sort

**What to build:** A Snapshot can be renamed, given a note, and deleted behind a confirmation. The library can be searched and sorted so it stays usable once it holds several hundred entries.

**Blocked by:** 03

**Seams:**
- S8 Library store — catches mutation persistence and conflict-free updates; misses UI state.

**Tracker:** None
**Status:** done

- [x] Renaming a Snapshot persists across restart.
- [x] A note can be attached to a Snapshot and persists across restart.
- [x] Deleting requires confirmation and is permanent.
- [x] Search matches on name, Identity and UID.
- [x] Sorting by name and by captured time both work.
- [x] A library of 500 Snapshots remains interactive while filtering.
- [x] Cancelling an edit leaves the stored Snapshot unchanged.

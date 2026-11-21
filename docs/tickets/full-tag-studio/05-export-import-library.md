# 05: Export and import the library

**What to build:** The whole library exports to a file the user chooses and imports back, with a preview of what will be added and what conflicts with what is already there. Import never silently duplicates or destroys existing entries.

**Blocked by:** 03

**Seams:**
- S8 Library store — catches round-trip fidelity and conflict handling; misses UI state.

**Tracker:** None
**Status:** done

- [x] Exporting produces a file that re-imports to an identical library.
- [x] Import previews how many Snapshots and Drafts will be added before applying.
- [x] Importing over existing entries neither silently duplicates nor destroys them.
- [x] A malformed import file is rejected without modifying the library.
- [x] Cancelling an import leaves the library untouched.

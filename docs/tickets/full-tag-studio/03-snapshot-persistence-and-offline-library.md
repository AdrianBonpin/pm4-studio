# 03: Snapshots persist to a library file and browse offline

**What to build:** Reading a tag and saving it produces a Snapshot that survives quitting the app and is visible with no Reader attached. The library lives in a versioned JSON file in the app data directory and is replaced atomically, so an interrupted save leaves the previous library intact. A corrupt file, or one written by a newer version, is reported and left untouched rather than silently replaced.

**Blocked by:** 01

**Seams:**
- S8 Library store — catches persistence, atomic replacement, corruption handling and version refusal; misses UI state.

**Tracker:** None
**Status:** ready

- [ ] A saved read survives quitting and reopening the app.
- [ ] The library lists with no Reader attached.
- [ ] A file written by a newer schema version is reported and never rewritten.
- [ ] A file that fails to parse is reported and never replaced with an empty one.
- [ ] Interrupting the app during a save leaves the previous library intact.
- [ ] An empty library explains what a Snapshot is instead of showing a blank area.
- [ ] The user is told the library is local plaintext and never synced.
- [ ] Saving a read that is already in the library does not create a duplicate.

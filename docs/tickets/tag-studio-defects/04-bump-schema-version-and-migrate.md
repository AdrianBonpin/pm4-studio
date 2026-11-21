# 04: Bump the schema version and migrate v1 on open

**What to build:** The library file declares version 2, and a version 1 file is lifted to
version 2 on the first successful open with every Snapshot and Draft preserved in order.
The file on disk claims version 2 before the user can edit anything, so a build that
understands only version 1 meets a file it refuses rather than a file it silently
strips. A migration that cannot be written is reported, and the app continues with the
migrated library in memory rather than refusing to open.

**Blocked by:** 03

**Seams:** The version gate and the migration step. Catches a version claim that lags the
file's contents, a migration that drops or reorders a collection, and a migration write
that bypasses the single serialisation domain. Misses the case that motivated this —
only a v1-era build can demonstrate a v2 file being refused, so the mechanism is proven
with a fixture claiming one version above what the build understands.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/7
**Status:** ready

- [ ] A file claiming a version above what the build understands is refused and not rewritten.
- [ ] A version 1 file is migrated on first open with Snapshots and Drafts preserved in order.
- [ ] After a successful open the file on disk claims version 2.
- [ ] Migration completes before any edit can be applied to the library.
- [ ] A failed migration write is reported and the library stays usable in memory.
- [ ] A library reloads with its Drafts unchanged after a save and restart.
- [ ] The migration write takes the single serialisation domain from ticket 03.

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
**Status:** done

- [x] A file claiming a version above what the build understands is refused and not rewritten.
- [x] A version 1 file is migrated on first open with Snapshots and Drafts preserved in order.
- [x] After a successful open the file on disk claims version 2.
- [x] Migration completes before any edit can be applied to the library.
- [x] A failed migration write is reported and the library stays usable in memory.
- [x] A library reloads with its Drafts unchanged after a save and restart.
- [x] The migration write takes the single serialisation domain from ticket 03.

## Outcome

`SCHEMA_VERSION` is 2, and a version 1 file is lifted on the first successful open,
before any edit can be applied, and written back through the store's atomic replace
inside the serialisation domain ticket 03 established. The lift works on the parsed
document rather than the struct, so a collection this build does not model is carried
through it; `Lifted::message` reports a lift that could not be written, and the app keeps
using the lifted library in memory. The migration write and the v1 fixture were each
checked against a broken implementation and went red.

**Residual gap disclosed here, and since fixed.** The lift preserved every key because
it wrote the document. The save path did not: `LibraryStore::replace` serialised the
`Library` struct, which is exactly `version/snapshots/drafts`, so the first ordinary save
after a lift — and after an import, and in a file already at v2 — silently dropped every
other top-level key. Two of this ticket's claims therefore held only for the open and not
for the session that followed it: "with every key preserved" in the spec line, and the
reason `library_schema` exists, that a migration must not drop a collection. A file lifted
intact and then emptied of its unknown keys by the next keystroke is the same loss with
an extra step.

It was left disclosed rather than fixed because it is the save path's defect, not the
migration's. It is now fixed: `Read` keeps the keys the typed half does not own, and
`replace` writes them back through the same `document_from` that an export uses, with
`TYPED_KEYS` as the one list of what the struct owns. Two tests prove it — a v1 file
carrying `tags` and `futureCollection` is lifted, then saved, and still carries them; and
a file already at v2 keeps them through a whole-library save, where no lift runs at all.
Both failed before the change.

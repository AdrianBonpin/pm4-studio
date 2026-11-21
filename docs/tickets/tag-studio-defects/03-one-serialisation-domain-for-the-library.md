# 03: One serialisation domain for the library file

**What to build:** Two saves that overlap in time both survive. Today the library store
and the import/export path each serialise against their own lock and each replace the
whole file, so two saves can read the same starting state and each rename a file holding
only its own change — one update lost, nothing reported. After this, a single
serialisation domain governs every write, so overlapping saves queue and both land.

**Blocked by:** None (can start immediately)

**Seams:** The store lock boundary. Catches a write path that bypasses serialisation and
an interleaving that drops an update. Misses operating-system rename semantics, which
the atomic-write behaviour already relies on.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/5
**Status:** done

- [x] Every write to the library file passes through one serialisation domain.
- [x] A Draft save and a Snapshot save in quick succession both land.
- [x] Overlapping saves queue rather than fail.
- [x] The file parses after any interleaving of the two paths.
- [x] No caller can reach the file except through the one path that holds the lock.
- [x] Single-writer behaviour is unchanged, including the atomic replace.

# 06: Migrate existing saved reads into the library

**What to build:** On first launch after the library exists, saved reads from the old webview store appear as Snapshots. The old store is left intact rather than cleared, so a failed migration loses nothing. A stored read that cannot be mapped cleanly is preserved as a raw-only Snapshot rather than dropped.

**Blocked by:** 03

**Seams:**
- S8 Library store — catches migration mapping and idempotency; misses UI state.

**Tracker:** None
**Status:** done

- [x] Existing saved reads appear as Snapshots after first launch.
- [x] The old webview store still contains its data afterwards.
- [x] A stored read that cannot be mapped becomes a raw-only Snapshot rather than being dropped.
- [x] Restarting the app does not duplicate migrated Snapshots.
- [x] Migration does not run when the library file already exists.

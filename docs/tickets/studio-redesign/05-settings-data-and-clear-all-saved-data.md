# 05: Settings → Data: library path, export/import, and clear all saved data

**What to build:** The library file stops being somewhere you cannot find. Its location is shown and can be revealed, the whole library can be exported and imported from Settings rather than from the browsing page, and one deliberate action clears everything this app has saved.

**Blocked by:** 03

**Seams:**
- Clear-data scope — catches exactly which paths and keys are resolved, that no path comes from input, that a partial removal refuses, and that the report matches what was removed; misses real filesystem behaviour outside a temporary directory.
- Library store (existing) — catches that the clear path cannot become a fallback for a failed save; misses nothing currently covered.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/17
**Status:** ready

- [ ] The library file's location is shown on the page and can be revealed in the file manager.
- [ ] Export and import are reachable from Settings and behave as they do today: an export re-imports identically, an import adds what is missing and leaves existing entries untouched.
- [ ] One clear-all action removes the library file, any stale temporary sibling left beside it, the legacy saved-reads store, and this app's preference keys.
- [ ] The action is gated by typing the word `clear`. A second click is not the gate.
- [ ] The action reports exactly what it removed.
- [ ] If any target cannot be removed the action refuses and says so rather than completing partially, and it names which part it could not remove.
- [ ] It accepts no path from input and follows no symlink, so it cannot reach anything outside this app's own storage.
- [ ] It is unreachable as a fallback from a failed save or an unreadable file; it is only ever user-initiated from this group.
- [ ] After clearing, the app shows its first-run state without needing a restart, and a cleared preference falls back to its documented default.
- [ ] Deleting a file is a deliberate, documented exception to the never-destroy-an-unreadable-file rule, not a second write path. The exception is written down where the rule lives.

# 02: Keep a queued Draft edit through window close

**What to build:** Type into a Draft and quit immediately: the edit is on disk when the
app reopens. Closing the window waits for anything still queued, so the exit path is no
longer the one place where a save can be dropped. If that final save cannot be written,
the window does not close over the loss — the problem is reported and the user decides
whether to quit anyway.

**Blocked by:** 01

**Seams:** The Draft save queue and the window-close path. Catches an edit dropped when
the window closes, a stale Draft written on the way out, and a close that proceeds over
a failed save. Misses whether the file system durably persisted the bytes — the library
store seam owns that.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/6
**Status:** ready

- [ ] An edit followed immediately by window close is present after relaunch.
- [ ] Closing during an in-flight save never writes a stale or partial Draft.
- [ ] Navigating away from Drafts still flushes, exactly as today.
- [ ] A final save that fails reports the problem and asks whether to quit.
- [ ] Choosing to quit anyway closes without a further attempt at saving.
- [ ] An idle window closes with no added delay.

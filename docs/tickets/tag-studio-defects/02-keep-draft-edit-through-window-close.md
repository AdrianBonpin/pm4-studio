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
**Status:** done

- [x] An edit followed immediately by window close is present after relaunch.
- [x] Closing during an in-flight save never writes a stale or partial Draft.
- [x] Navigating away from Drafts still flushes, exactly as today.
- [x] A final save that fails reports the problem and asks whether to quit.
- [x] Choosing to quit anyway closes without a further attempt at saving.
- [x] An idle window closes with no added delay.

**How the close path is proven without a window.** `@tauri-apps/api/window` runs
unmodified. `onCloseRequested` registers through `plugin:event|listen`, so the test
hands the *registered handler* the event Rust emits, and the handler's own decision —
`preventDefault` or not — is what closes the window. The outcome is then read where it
happens: a destroyed window is a `plugin:window|destroy` call at the same IPC boundary
every other command crosses, so "the window went" and "the window was held open" are
observations, not inferences. The fake is a store rather than a stub: `draft_save`
writes the Draft it is sent and `drafts_load` answers from it, so rendering the page
again is a relaunch and reads back what the first run left.

**What the tests are worth.** Each was checked against a broken implementation and went
red, then the break was reverted. Removing the close listener fails seven of the eight
tests — every one with a close in it; the eighth, the navigate-away flush, has no close
to lose. Removing the unmount flush fails that one. Making `settle` always await one
timer tick fails the idle-window test, which allows only microtasks, so "no added delay"
is a bound rather than a claim. Ignoring whether a newer edit overtook an in-flight
write fails both the in-flight and the overtaken-write tests. Attempting the save again
from "Quit anyway" fails the failed-save test's count of one attempt.

**Two things the code has to remember, beyond "flush on close".** A write that is
already out is awaited *before* what is queued is written, because a queued Draft is by
definition newer: writing the other way round would let the older copy land last and
become the file. And a Draft is only "saved" when a write carrying its newest revision
returns — a finished write that a later keystroke overtook leaves it unsaved, which is
what keeps a second close from slipping out over the edit still on screen after a
failed save and a "Keep editing".

**Config change.** `core:window:allow-destroy` is added to
`src-tauri/capabilities/default.json`. Destroying the window is how "quit anyway"
leaves; the JS API's own `destroy` command is not in `core:default`, which grants only
the window getters. No new Rust command, no schema change — ticket 04 owns the file
format.

**Suite:** `bun run test` 33 files / 425 tests; `cargo test --manifest-path
src-tauri/Cargo.toml` 350. Both green. `bunx tsc --noEmit` and `bun run build` clean.

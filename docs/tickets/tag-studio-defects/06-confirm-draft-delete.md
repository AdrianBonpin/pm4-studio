# 06: Confirm a Draft delete before removing it

**What to build:** The trash control on a Draft opens a confirmation that names the
Draft and says what is about to be lost, instead of deleting on the first click.
Dismissing keeps the Draft exactly as it was; confirming removes that Draft and no
other. Today the control removes it immediately, which makes Draft deletion the only
deletion in the app with no way back — a Snapshot can be re-read from its tag, but a
Draft was authored and never lived on a tag, so nothing can regenerate it.

**Blocked by:** 01

**Seams:** The Draft delete gate, proven through the interface. Catches a confirmation
that deletes on dismiss, one that does not name what it is about to destroy, and a gate
that exists but can be bypassed. Misses whether the store actually persisted the
removal — the library store seams own that.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/9
**Status:** ready

- [ ] Clicking the trash control on a Draft does not remove it.
- [ ] The confirmation names the Draft being removed.
- [ ] Dismissing leaves the Draft present and unchanged.
- [ ] Confirming removes that Draft and leaves every other Draft untouched.
- [ ] Removing the confirmation from the control fails a test.
- [ ] The confirming control reads as destructive, the same way every other
      irreversible action in the app does.

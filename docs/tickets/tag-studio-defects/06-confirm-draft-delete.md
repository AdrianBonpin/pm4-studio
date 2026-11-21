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
**Status:** done

- [x] Clicking the trash control on a Draft does not remove it.
- [x] The confirmation names the Draft being removed.
- [x] Dismissing leaves the Draft present and unchanged.
- [x] Confirming removes that Draft and leaves every other Draft untouched.
- [x] Removing the confirmation from the control fails a test.
- [x] The confirming control reads as destructive, the same way every other
      irreversible action in the app does.

## Outcome

The Drafts row's trash control now opens an in-row confirmation, the shape the
Snapshot delete in `LibraryPage.tsx` already had: the Draft is named, the sentence
says why nothing can read it back, the dismissing control is `Keep`, and the
confirming control is the `danger` variant reading `Delete permanently`. The removal
happens from that button and from nowhere else.

`src/pages/DraftsPage.test.tsx` is now the pair of proofs D5 asks for, plus the
narrowness this ticket adds: dismissing removes nothing and leaves both Drafts
listed, confirming asks the store for that Draft's id, and confirming one Draft from
a list of three leaves the other two in place. Gate 2 now carries both halves, which
is what makes D5's count of eight true — the other seven were proven by ticket 01.

# 10: Drafts becomes a collection inside Library

**What to build:** A Draft is edited beside the list that holds it, never below an unrelated panel. Drafts is a second collection of the same page rather than a destination of its own, and the panel that existed only to read a tag into a draft is gone.

**Blocked by:** 07, 08

**Seams:**
- Collection switch (new) — catches which collection is active and that one collection's selected item never appears in the other; misses nothing the DOM harness cannot see.
- Confirmation gates (existing) — catches a Draft delete that stopped asking; misses nothing currently covered.
- Vocabulary guard (existing) — catches a Draft described as a Snapshot or vice versa; misses the same confusion in code.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/22
**Status:** done

- [x] Drafts is reachable as the second collection in one click, and the active collection is unmistakable.
- [x] The Draft list sits beside the Records editor.
- [x] The Records editor never appears below an unrelated panel, and selecting a Draft does not require scrolling to find its Records.
- [x] Adding, editing, reordering and deleting a Record all still work, and the per-Record and total encoded size are still shown against capacity where capacity is known.
- [x] An invalid Record still explains itself inline and does not toast.
- [x] Writing a Draft to a tag is reachable from the editor, with its confirmation and read-back unchanged.
- [x] Deleting a Draft still takes a second, deliberate confirmation.
- [x] The read-a-tag-into-a-draft panel is gone.
- [x] A queued Draft edit is still written when the window closes, and the close guard still holds the window on a failed final save.
- [x] The library-unwritable condition still disables every control in both collections.

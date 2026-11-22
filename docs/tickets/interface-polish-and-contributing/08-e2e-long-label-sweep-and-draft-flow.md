# 08: E2E — the long-label sweep and the Draft list's own flow

**What to build:** The two claims that are about interaction rather than layout, re-proved
against this branch. The long-label sweep at the minimum window shows that no control's
label wraps and that each mode is one click from the others. A new report shows the Draft
list being used: narrowed by typing, emptied by a query that matches nothing, cleared,
used to choose a Draft, and followed by the write panel for that Draft.

**Blocked by:** 01, 02, 03, 04, 05

The sweep is a claim about the final shapes and width, and the new flow cannot be captured
before the Draft list exists.

**Seams:**
- The sweep at 900×700 — catches a label that wraps onto a second line and a mode that is
  more than one click away; misses sizes larger than the minimum, where nothing can wrap
  that does not wrap there.
- The new Draft-list report — catches the search narrowing the list, the no-match state,
  the cleared state, the choice, and the write panel appearing for it; misses the Draft's
  Records being correct on a Tag, which no fixture can show.

- [x] The long-label sweep is re-run at 900×700 over every destination and every mode, and every label stays on one line.
- [x] The sweep report states which labels it covers and records that each mode is one click from the others.
- [x] A new report exists for the Draft list, with images for: the list on arrival with nothing chosen, a query that narrows it, a query that matches nothing, the query cleared, a Draft chosen, and the write panel that follows.
- [x] The new report says plainly what the fixture backend can and cannot stand for.
- [x] The E2E index links the new report and lists it beside the existing ones.
- [x] No claim in either report rests on an image taken before this branch.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/41
**Status:** done

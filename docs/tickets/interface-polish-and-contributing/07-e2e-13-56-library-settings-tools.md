# 07: E2E — the 13.56 MHz page, the Library, and Settings with Tools, both viewports

**What to build:** The same re-capture for the rest of the interface: the five 13.56 MHz
modes including a decoded readout with its Records and the raw-only fallback, the Copy
flow, Library's two Collections with and without a selection, Settings' four groups, and
Tools. Each at 980×760 and at the 900×700 minimum, from this branch.

**Blocked by:** 01, 02, 03, 04, 05

The shape and width changes appear on every one of these destinations, and the 13.56 MHz
Write mode now shows the Draft list where it used to show a dropdown.

**Seams:**
- The capture pass at both viewports — catches that each destination, mode, Collection and
  Settings group renders and that nothing wraps at the minimum; misses real hardware
  behaviour, as every report in this set does.

- [ ] Every image in the 13.56 MHz report is re-captured at both viewports, including a decoded readout with its Records, a raw-only readout, and the Copy flow.
- [ ] The 13.56 MHz Write mode's image shows the Draft list, not a dropdown.
- [ ] Every image in the Library report is re-captured at both viewports, in both Collections, with nothing selected and with an item open.
- [ ] Every image in the Settings and Tools report is re-captured at both viewports, across all four Settings groups and the console.
- [ ] Each report's claims are re-checked and corrected where the new shape or width changed them.
- [ ] No image from the previous capture survives in these reports.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/40
**Status:** ready

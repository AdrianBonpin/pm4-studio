# 06: E2E — the shell and the 125 kHz page, both viewports

**What to build:** The shell, its five destinations and the four message corners, and the
five 125 kHz modes, re-captured at 980×760 and at the 900×700 minimum against the fixture
backend, so the committed evidence shows the interface this branch ships rather than the
one it replaced. The reports' claims are re-checked while re-capturing: anything the new
shape or width falsified is corrected, not left standing.

**Blocked by:** 01, 02, 03, 04

The controls' shape, the page's width and the Destroy divider's visibility all appear in these
two reports.

**Seams:**
- The capture pass at both viewports — catches that each destination and each 125 kHz mode
  renders, that no control's label wraps at the minimum, and that a message appears in each
  corner; misses everything about real hardware, which the fixture cannot stand for.

- [x] Every image in the shell and corners report is re-captured at both viewports, from this branch.
- [x] Every image in the 125 kHz report is re-captured at both viewports, from this branch.
- [x] The shell report still shows all five destinations and a message in each of the four corners.
- [x] The 125 kHz report still shows all five modes, including a readout, a confirmation, and the confirmation that destroys a Tag.
- [x] The 125 kHz report names its five modes with the glossary's words — Clear, and Destroy for the destructive one — and no longer calls the everyday operation Reset.
- [x] Each report's claims are re-checked and corrected where the new shape or width changed them.
- [x] No image from the previous capture survives in either report.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/39
**Status:** done

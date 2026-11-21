# 20: Verify the redesign visually and on hardware

**What to build:** The redesign is seen at the sizes it actually ships at and exercised on real tags, so a wrapping control or a layout that only holds together on the developer's monitor is found here rather than by you.

**Blocked by:** 19

**Seams:**
- Visual gate (new) — catches wrapped controls, layout at the minimum window, mode switching and the two-pane structure; misses taste and anything the rule set does not encode.
- Manual hardware checklist — catches device behaviour no test can reach: real UIDs, real writes, real refusals; misses nothing within its own scope, and claims nothing outside it.

Browser verification renders the interface with the device boundary stubbed, which is enough for layout and not enough for any claim about a tag. Nothing about a tag, a write or a beep is concluded from a browser. The stub must not reach a release build; a release build reaching it must fail rather than answer from a fixture.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/30
**Status:** ready

- [ ] Screenshots at 980×760 and at the 900×700 minimum for: the shell with five destinations and a message in each of the four corners; each 125 kHz mode; each 13.56 MHz mode; Library in both collections with and without a selection; all four Settings groups; Tools.
- [ ] No control wraps onto a second line at the minimum size, and the sweep covers the longest labels in the app.
- [ ] Hardware checklist: a 4-byte-UID MIFARE Classic 1K reads as itself with its full 4-byte UID; a 7-byte-UID NTAG reads its full UID with no raw fallback.
- [ ] Hardware checklist: a Copy between two tags verifies, and a copy onto an oversize destination is refused before anything is written.
- [ ] Hardware checklist: a never-written tag resets; the same tag reset again reports that it will not accept writes, with three chirps and the held LED.
- [ ] Hardware checklist: a 125 kHz clone, a batch over several Blanks, and an authored Identity each report their own outcomes.
- [ ] The four-symbol alphabet is confirmed distinguishable by ear, and the gap between chirps is recorded as the tuned value.
- [ ] The device stub is provably absent from a release build.
- [ ] Every finding is recorded. A failure becomes a follow-up ticket rather than being absorbed silently into this one.

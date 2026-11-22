# 20: Verify the redesign visually and on hardware

**What to build:** The redesign is seen at the sizes it actually ships at and exercised on real tags, so a wrapping control or a layout that only holds together on the developer's monitor is found here rather than by you.

**Blocked by:** 19

**Seams:**
- Visual gate (new) — catches wrapped controls, layout at the minimum window, mode switching and the two-pane structure; misses taste and anything the rule set does not encode.
- Manual hardware checklist — catches device behaviour no test can reach: real UIDs, real writes, real refusals; misses nothing within its own scope, and claims nothing outside it.

Browser verification renders the interface with the device boundary stubbed, which is enough for layout and not enough for any claim about a tag. Nothing about a tag, a write or a beep is concluded from a browser. The stub must not reach a release build; a release build reaching it must fail rather than answer from a fixture.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/30
**Status:** ready — the browser half (criteria 1, 2, 8, 9) is verified, with the evidence under `docs/superpowers/e2e/`; the hardware half (criteria 3–7) is deferred to you, unrun and unticked, to be run from `docs/superpowers/hardware-checklist-studio-redesign.md`.

- [x] Screenshots at 980×760 and at the 900×700 minimum for: the shell with five destinations and a message in each of the four corners; each 125 kHz mode; each 13.56 MHz mode; Library in both collections with and without a selection; all four Settings groups; Tools. — `docs/superpowers/e2e/`, 52 images
- [x] No control wraps onto a second line at the minimum size, and the sweep covers the longest labels in the app. — 0 of 372 controls over 25 states at 900×700; `docs/superpowers/e2e/06-long-label-sweep.md`
- [ ] Hardware checklist: a 4-byte-UID MIFARE Classic 1K reads as itself with its full 4-byte UID; a 7-byte-UID NTAG reads its full UID with no raw fallback.
- [ ] Hardware checklist: a Copy between two tags verifies, and a copy onto an oversize destination is refused before anything is written.
- [ ] Hardware checklist: a never-written tag resets and reports *Blanked* with no copy counted; the same tag reset again refuses as **nothing to blank**, which is a different outcome from *will not accept writes*. The *will not accept writes* outcome stays unobserved until a chip refuses a transmitted write while still reading an Identity back.
- [ ] Hardware checklist: a 125 kHz clone, a batch over several Blanks, and an authored Identity each report their own outcomes.
- [ ] The four-symbol alphabet is confirmed distinguishable by ear, and the gap between chirps is recorded as the tuned value.
- [x] The device stub is provably absent from a release build. — `docs/superpowers/e2e/07-release-build-proof.md`: absent from `dist/`, and a production build that does include it refuses to render
- [x] Every finding is recorded. A failure becomes a follow-up ticket rather than being absorbed silently into this one. — `docs/superpowers/e2e/08-findings.md`; seven follow-up tickets in `docs/tickets/studio-redesign-followups/`

## Report from this run

The browser half is done and the hardware half is not.

- **Ticked:** the screenshot pair for every named surface, the no-wrap sweep at the
  minimum size, the stub's absence from a release build (with a fail-closed proof),
  and the recording of every finding. Evidence under `docs/superpowers/e2e/`.
- **Criteria 3–7 are NOT RUN.** There was no Reader and no tag in the environment
  that produced this, so nothing about a tag, a write, a beep or an LED is claimed.
  They are written out as a runbook — exact steps, the expected observation in both
  channels, the expected symbol (1 chirp done / 2 needs-you / 3 attention with the
  two-second LED), and what a failure would look like — at
  `docs/superpowers/hardware-checklist-studio-redesign.md`. All seven items,
  including the chirp-gap tuning, expect a person with hardware.
- **Findings:** seven follow-up tickets in `docs/tickets/studio-redesign-followups/`.
  Four were raised by the browser pass (Diagnostics states two capabilities it does
  not have; Copy refuses an empty destination; the Erase confirmation overflows the
  window; Reset is called "Blank" in its own panel) and three by the work around it
  (device commands run on the main thread; Reset's refusal has never been seen on
  hardware, and a blanked tag may stop answering; clearing a tag must leave it
  usable rather than destroying it). Plus three recorded observations and two stated
  limits of the verification itself, in `docs/superpowers/e2e/08-findings.md`.

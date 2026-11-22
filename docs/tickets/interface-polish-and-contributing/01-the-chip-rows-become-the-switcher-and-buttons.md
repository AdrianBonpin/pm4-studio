# 01: The hand-rolled chip rows become the switcher and buttons

**What to build:** The two ways of entering an Identity are offered as the app's one
switcher — one labelled group, one pressed option, the same behaviour as every other
switcher — and the console's seven frame presets are buttons that fill the frame field
rather than chips that look like a selection. What a user can do does not change;
what the controls *are* changes, so that the shape change in ticket 02 happens once
instead of three times.

**Blocked by:** None (can start immediately)

**Seams:**
- The switcher component's contract — catches that the folded Identity pair is a real
  switcher (one labelled group, exactly one option pressed, order preserved, labels on
  one line) rather than a look-alike; misses anything about its painted shape, which
  this ticket does not change.
- The Identity page as rendered — catches that each choice still reveals its own entry
  form and that a value typed under one is not submitted by the other; misses styling.
- The Tools page as rendered — catches that pressing a preset fills the frame field and
  sends nothing; misses whether the control still looks like a chip.

- [ ] The Identity entry offers its two choices as one labelled group of options, with the chosen one reported as pressed.
- [ ] Each option in that group is reachable and operable by keyboard alone.
- [ ] Choosing either option shows that option's own entry form; a value entered under one is not used by the other.
- [ ] The seven console presets are the app's button component, in its quiet secondary vocabulary, and pressing one fills the frame field without sending.
- [ ] No second implementation of a two-or-more-option switcher remains in the interface.
- [ ] `bun run verify` passes, and no test mocks an app-internal module.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/33
**Status:** ready

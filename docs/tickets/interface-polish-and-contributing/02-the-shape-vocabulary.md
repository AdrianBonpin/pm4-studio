# 02: The shape vocabulary: switcher 4px, buttons 6px, one pill

**What to build:** Every switcher in the app — band modes, Collections, Settings groups,
Quiet level, the Toast corner, the Identity entry — is a cornered chip with 2px above
and below its label, and every action button is a 6px rectangle. The Toggle is the only
pill left in the interface, because a switch is a physical affordance and reads as one.
`DESIGN.md` is rewritten to describe the vocabulary the app now has, rather than the one
it had.

**Blocked by:** 01

The folded call sites must already be switchers, or the shape has to be applied twice and the two
old chip implementations survive.

**Seams:**
- The switcher component's contract — catches that every label still sits on one line at
  the 900×700 minimum and that option order and the pressed state survive the restyle;
  misses the corner radius and padding, which no DOM assertion can honestly own.
- The design check — catches a rule the new classes violate; misses the specific radius
  and padding values, which are not rules it encodes. The rendered result at both
  viewports is the evidence for the shape itself.

- [ ] Every switcher sits on one row at 900×700 with every label on a single line, options 4px-cornered with 2px above and below the label.
- [ ] Every action button has a 6px corner, and its four variants stay distinguishable by fill, border and ink rather than by corner.
- [ ] The Toggle is the only fully rounded control in the app.
- [ ] `DESIGN.md`'s radii, its buttons section and its Do's describe what the app does now, with no line left pinning buttons to a pill.
- [ ] No allow-list entry is added to the design check to make the new classes pass.
- [ ] `bun run design:check` and `bun run verify` pass.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/38
**Status:** ready

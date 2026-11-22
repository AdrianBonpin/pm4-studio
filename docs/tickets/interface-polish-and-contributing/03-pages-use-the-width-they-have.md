# 03: Pages use the width they have

**What to build:** A page is no longer a 768px column floating in the window. The rules
that separate one section from the next reach both edges of the content area, the text
keeps a 24px inset from those edges, and a maximised window is used rather than
letterboxed. A form group or a paragraph keeps a readable measure, so "use the width"
does not become "stretch the measurements". A divider inside a section body stays
aligned with that body's content.

**Blocked by:** None (can start immediately)

**Seams:**
- The shell's page container, as rendered — catches that the width cap is gone, that the
  header and the section bodies share one inset, and that all five destinations still
  render with no Reader attached; misses the painted width, because the test environment
  has no layout. The rendered page at both viewports is the evidence for that half.
- The design check — catches a rule violated by the new classes; misses whether a rule
  actually reaches an edge.

- [ ] No page is capped in a centred column: at a maximised window the content uses the pane.
- [ ] The rules between sections reach both edges of the content area, and the text they separate sits at one inset from those edges.
- [ ] A divider inside a section body lines up with that section's content, not with the window.
- [ ] A form group and a prose block keep a readable measure instead of stretching to a wide window.
- [ ] At 900×700 every page's primary action is still reachable without scrolling, as before.
- [ ] `bun run verify` passes.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/34
**Status:** ready

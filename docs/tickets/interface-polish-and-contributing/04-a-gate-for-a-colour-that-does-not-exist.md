# 04: A gate for a class that names a colour which does not exist

**What to build:** The Destroy block on the Clear panel gets the visible hairline above it
that it was written to have, and the build learns to refuse a class naming a colour the
palette does not define. The gate takes the shape the design check already has: a named
command, a testable module, and a test — wired into the build, so it fails `bun run verify`
rather than waiting to be run by hand.

**Blocked by:** None (can start immediately)

**Seams:**
- The gate as a command — catches a border colour that names nothing, and reports which
  class and where; catches its own absence as a failure rather than a pass.
- The gate's module under test — catches that a border width, a border style, a side, an
  opacity modifier, an arbitrary value, and a colour name appearing in prose do **not**
  fire; misses typo'd utilities of other kinds (spacing, type sizes), which stay out of
  its remit.

- [ ] The Destroy block on the Clear panel is separated from what is above it by a visible hairline, in both the connected and the disconnected state.
- [ ] A class naming an undefined border colour fails the build, and the failure names the class and where it is.
- [ ] The gate stays silent for border widths, styles, sides, opacity modifiers, arbitrary values, and colour names written in prose or comments.
- [ ] It runs inside `bun run build`, so `bun run verify` fails with it.
- [ ] The gate is covered by a test that would fail if it stopped reporting the typo it was built for.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/35
**Status:** ready

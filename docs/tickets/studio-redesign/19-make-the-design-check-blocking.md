# 19: Make the design check blocking and clear the remainder

**What to build:** The patterns this work removed cannot quietly return. A design-rule violation fails the build, and the only rules the app is allowed to override are the ones the incumbent design system genuinely wins, each with a written reason.

**Blocked by:** 18

**Seams:**
- Design check (existing, from 01) — catches rule violations across the component sources and fails the build; misses taste, and anything the rule set does not encode.
- The allow-list itself — catches a suppression with no reason; misses a reason that is merely a restatement of the rule.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/29
**Status:** ready

- [ ] The design check fails the build on any violation.
- [ ] It runs as part of the repository's ordinary verification command, alongside the existing type check, test suite and Rust tests.
- [ ] The allow-list of rules the incumbent design system overrides has one entry per rule, each with a written reason.
- [ ] An allow-list entry without a reason fails the check, so a suppression cannot be added silently.
- [ ] An unavailable or unauthenticated detector fails the check loudly rather than being skipped.
- [ ] The check passes on the finished tree, and the run is reproduced from a clean working copy.

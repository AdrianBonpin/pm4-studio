# 09: A contribution guide that states the convention

**What to build:** One page that tells a stranger what this repository expects of a commit
and of a pull request, and what it does not. It names the eleven commit types and no
invented ones, the optional scopes drawn from the app's own vocabulary, the shape of a
subject, how a breaking change is marked, and why the pull-request title has to be a
Conventional Commit subject itself: squash-merge makes the title the commit on `prod`. It
states the branch → pull request → squash-merge → delete flow, says the convention applies
from the day the guide lands and that earlier history is not rewritten, and says plainly
that nothing enforces any of it. `README.md` links it once.

**Blocked by:** None (can start immediately)

**Seams:**
- None. The guide is stated, not enforced: no test, hook, status check or gate reads it.
  It is verified by being read, and its drift from practice is a review matter. This is
  recorded so that a later reader does not mistake the absence of a check for an oversight.

- [x] The guide names the eleven commit types, and says no others are used.
- [x] It gives the optional scopes, drawn from this app's vocabulary, and says a scope is optional.
- [x] It gives the subject's rules: imperative mood, lowercase, no trailing period, a 72-character ceiling.
- [x] It shows how a breaking change is marked, and that it needs a footer naming it.
- [x] It states that a pull-request title is the same shape as a commit subject, and why.
- [x] It states the branch, pull request, squash-merge and branch-deletion flow, and that `prod` is never committed to directly.
- [x] It says the convention applies going forward and that existing history is not rewritten.
- [x] It says that nothing enforces the convention — no hook, no status check, no CI.
- [x] It names `bun run verify` as the gate to run before opening a pull request, and that the design check is part of it.
- [x] It names the host the flow runs on, so a reader is not left to assume the wrong one.
- [x] `README.md` links the guide once, and nothing in the guide claims a check that does not exist.

**Tracker:** https://github.com/AdrianBonpin/pm4-studio/issues/37
**Status:** done

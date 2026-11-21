# 0008: Every operation reports through one seam that drives both the visible message and the audible signal

**Status:** Accepted
**Date:** 2026-11-22

## Context

The app grew a beep early: a boolean preference, a `chirp()` helper, and an
`onChirp` callback threaded through the components that happened to need one.
Nine of roughly thirty user-visible operations ended up calling it. None of them
called it on failure, because the helper has no severity — it is a single
unconditional chirp, so it could not express failure even if a caller wanted to.

The same growth produced four unrelated error channels: a shell notice strip, a
library-lock banner, per-component local state, and one-line notes. An error
raised in the memory panel is invisible from the library, and nothing survives
leaving the page.

Two symptoms, one cause. Nobody decided what an operation's result *is*, so every
surface invented its own answer, and a surface that invented nothing was silent.
"Which operations report?" had no answer that could be checked, only a list that
could be incomplete — and was.

The tempting fix is to add the missing calls: thread a severity argument through
`onChirp`, add a toast helper, and call both where needed. That reproduces the
original failure at a larger scale. Two calls per operation drift, and the drift
is invisible: a component that calls neither looks exactly like a component whose
operation has nothing to report.

## Decision

One typed `Outcome` value describes what one operation did. It is reported through
a single seam. That seam fans out to the toast store and to the signal queue, and
severity is a property of the outcome rather than of the call site, so the two
channels cannot disagree.

Components never invoke the beeper and never construct a toast. An outcome that is
an announcement rather than an operation result may suppress the signal, and doing
so is the one explicit way a signal can be absent.

The seam does not cover everything. Background and automatic work — connecting,
the firmware query, autosave, the poll loop's iterations — reports nothing, by
design and not by omission. The rule is that an operation the user starts ends in
exactly one outcome.

## Consequences

- Coverage becomes structural. An operation that reports nothing is a visible gap
  in one place rather than a silence in thirty.
- "There is no beep on this" and "there is no message on this" stop being separate
  bugs, because they are the same bug.
- Adding an operation now requires deciding its outcome first. That is the point:
  the decision was previously skipped, and the skipping was the defect.
- The `onChirp: () => void` prop disappears from every component that carried it,
  which is a wide but mechanical change.
- The seam is the only place severity is chosen. A component that wants a special
  severity for its own case has to add an outcome variant, which makes the request
  visible and reviewable instead of local and invisible.

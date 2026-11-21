# 0001: Refuse to write 125 kHz tags unless the tag can be read first

**Status:** Accepted
**Date:** 2026-11-21

## Context

Command `0x0073` writes an EM4100 Identity onto a T5577 with no acknowledgement:
the firmware sends no reply, and the only evidence that a write happened is a
subsequent read. That means the app cannot ask the Reader "is a tag present?"
before writing — it can only find out by reading.

Two failure modes make blind writing unacceptable:

1. If the source tag is still on the Reader when the write is issued, the write
   lands on the original credential instead of the Blank. One such attempt
   permanently locked a T5577: it still reads, but refuses every subsequent
   write.
2. A write to an unreadable or absent tag produces no error, so a silent no-op
   is indistinguishable from success.

The convenient alternative — write, then check — is exactly the ordering that
caused the locked chip.

## Decision

The write path reads before it writes, and fails closed on both conditions:

- The tag on the Reader cannot be read at all → refuse. Writing blind means not
  knowing whether the target is the user's original credential.
- The tag already presents the Identity being written → refuse. This is almost
  certainly the source tag left in place, which is the exact case that locked a
  chip.

Neither refusal is a warning the user can dismiss. The write does not proceed.

## Consequences

- A user who taps a Blank poorly gets a refusal rather than a silent failure.
  The error names the cause ("could not read the tag on the reader") so the fix
  is obvious: re-seat the tag.
- Cloning a tag onto itself is impossible through the normal path, which also
  removes a way to lock a T5577 by accident.
- Batch writing must re-read between attempts, so "write the same Identity to N
  Blanks" cannot collapse into N rapid fire writes.
- The app can no longer serve a "write anyway" escape hatch without reversing
  this decision deliberately. That is the point: the guard is load-bearing and
  should not be removed as a convenience fix for a flaky read.
- The decision is a pure function (`src-tauri/src/write_guard.rs`) that takes
  what the tag in the write position reads as, and the Identity to be written.
  Both refusals are therefore exercised by tests that need no hardware, so a
  future change that weakens the guard fails a test rather than reaching a chip.

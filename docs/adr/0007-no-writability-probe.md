# 0007: A 125 kHz tag's writability is only discoverable by writing, and the app never offers a probe

**Status:** Accepted
**Date:** 2026-11-22

## Context

A T5577 that has been written once can permanently refuse every subsequent
write while still reading back perfectly. This project has already destroyed one
that way, and that incident is why ADR 0001 refuses to write a tag that already
presents the target Identity.

The consequence shows up as a support conversation. A user blanks a tag, the tag
still reads back as its old Identity, and the app reports that nothing changed.
Nothing in that report hints at the real cause, so the obvious next thought is
that the blanking payload must be wrong — and the obvious next request is for a
way to check first.

A 125 kHz read reply carries no chip family and no writability flag. There is no
command that answers "will this tag accept a write?", which means a pre-check
looks like a missing feature rather than an impossibility.

It is not a missing feature. **Every candidate probe is a write.**

- A write that changes the tag's Identity is destructive by definition. That is a
  Clone, not a probe.
- The only write that leaves content unchanged is the tag's own Identity written
  back to itself. That is precisely the operation ADR 0001 identifies as the
  ordering that permanently locked a chip. Building it as a diagnostic would be
  building the known chip-locker and calling it a safety check.

There is no third option. The writability question and the write are the same
operation.

## Decision

The app never offers a writability probe, in any surface, behind any
acknowledgement. Reset is documented as the writability test and says so before
it runs: a 125 kHz tag that has already been written may permanently refuse
further writes, this Reader cannot tell a writable T5577 from a locked one or
from a read-only EM4100, and the attempt is safe only on a tag the user can
afford to lose.

A refused Reset produces its own outcome — *this tag will not accept writes* —
separate from a generic failure and from *unverified*, with the likely cause
named. The capability limits state the limit once, so its absence reads as a
documented constraint rather than an oversight.

ADR 0001 is unchanged. The same-Identity refusal stays absolute and gains no
escape hatch.

## Consequences

- The app stops implying knowledge it does not have, and stops inviting a request
  it can never satisfy.
- A user who wants to know whether a tag is writable must spend a tag to find out.
  That is the hardware's constraint, not the app's, and the app now says so
  instead of letting the user discover it as a surprise.
- A refused write is no longer reported as "nothing changed". It is reported as
  evidence about the chip, which is the useful framing and the true one.
- Anyone who later proposes a probe has this document to read first. Removing this
  decision requires demonstrating a write that cannot alter a tag and cannot lock
  it, which is the same as demonstrating the probe is not a write.
- Because no probe exists, no new destructive path exists. The work that recorded
  this decision removed a misleading report and added no capability.

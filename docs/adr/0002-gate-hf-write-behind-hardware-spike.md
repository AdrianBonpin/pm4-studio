# 0002: Gate 13.56 MHz write behind a hardware spike rather than committing to it

**Status:** Accepted
**Date:** 2026-11-21

## Context

Every protocol capability this app relies on was verified against real hardware
before it was built on. The 125 kHz read and write paths both have captures and
test vectors. That is not true of anything on the 13.56 MHz side beyond reading a
UID.

The NTAG command family (`0x0081` read, `0x0082` write, `0x0083` info, `0x0084`
format) appears only in one third-party reverse-engineering project. That project
contains **no raw captures** of these commands, and their payloads are large —
writing needs a 1328-byte request and reading waits for ~17 USB reports. Our
frame parser currently assumes one report per frame, so even parsing these
responses is unbuilt.

Writing NDEF records — half of the product objective — is impossible without
those commands. But specifying a full record editor on top of an unverified
transport risks discovering, after substantial UI work, that the transport does
not work at all.

The alternative of committing outright has its own cost: the spec becomes a
promise the hardware may not keep, and the failure shows up as unbounded protocol
archaeology rather than as a scoping decision.

## Decision

13.56 MHz write is specified as the final Slice, explicitly gated on a Spike.

The Spike must, on real hardware, read an NTAG's memory and write to it
successfully, with the written value observed on a subsequent read. Until that
Spike returns a positive finding, the write Slice is not started.

If the Spike fails, the documented outcome is that the app is read-only on
13.56 MHz. That is a recorded result, not a scope surprise.

## Consequences

- The spec contains a conditional Slice. This is deliberate and is the reason
  this ADR exists — a future reader should not treat the condition as unfinished
  specification.
- The record editor and the tag-management features that depend on memory access
  are designed but not scheduled until the Spike clears.
- A negative Spike leaves a coherent product: full 125 kHz capability, 13.56 MHz
  reading and decoding, and a library. The remaining gap is explained by a
  documented hardware finding rather than an unfinished feature.
- The Spike is throwaway code. Its purpose is a finding, and it should not be
  promoted into the shipping write path without the normal verification the rest
  of the protocol has.

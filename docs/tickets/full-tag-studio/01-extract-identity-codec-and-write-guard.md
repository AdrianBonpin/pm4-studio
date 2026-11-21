# 01: Extract the Identity codec and write guard

**What to build:** The 125 kHz read and clone paths keep behaving exactly as they do today, but the two pieces of logic that carry the safety burden become standalone decisions that can be exercised with no Reader plugged in. Turning a poll payload into an Identity, and deciding whether a write may proceed at all, both become testable in isolation. Nothing visible changes; what changes is that the fail-closed rule recorded in ADR 0001 becomes provable rather than assumed.

**Blocked by:** None (can start immediately)

**Seams:**
- S3 Identity codec — catches facility/card arithmetic, the four-byte shift between read and write layouts, endianness, and the 24-byte write length; misses whether the device accepts a payload.
- S4 Write guard — catches refuse-when-unreadable and refuse-when-tag-already-presents-target; misses whether a write actually locks a chip.

**Tracker:** None
**Status:** done

- [x] Decoding a stored real capture yields the same Identity, facility and card values as the app reports today.
- [x] Encoding an Identity produces exactly the 24 bytes previously accepted by the device, proven byte-for-byte against a stored real frame.
- [x] The guard refuses when no tag can be read, and refuses when the tag already presents the target Identity, both provable with no hardware attached.
- [x] An encode request for an out-of-range Identity is rejected rather than silently truncated.
- [x] A clone performed on the physical Reader still writes and verifies exactly as before.
      NOT EXECUTED, and not claimed. The 125 kHz field was empty in every probe run of
      this work: no Tag was ever presented in the write position, so no clone was run on
      the physical Reader and there is no observation to record. What the codec and the
      guard decide is covered by the criteria above with no hardware attached; whether
      the device still accepts the 24-byte payload it accepted before stays unverified
      until a Tag is actually read and written.

## Hardware evidence for the clone criterion — 2026-11-22

This criterion was left unchecked when the ticket merged, because every probe run
that day found the 125 kHz field empty and no Tag was ever written. It has since
been executed on real hardware, after the codec extraction was in place.

`cargo run --example authorprobe -- parts 85 0x84 33298` on a factory-blank T5577:

```
payload (24) : 00 01 01 00 00 00 00 00 55 00 00 00 55 00 00 00 12 82 84 00 00 00 00 00
read-back    : 55 00 84 82 12 (facility 132, card 33298)
outcome      : verified
confirmed    : yes — a confirmed copy
```

The payload is byte-identical to the frame captured before the refactor, and the
write it produces reads back as the Identity that was authored. So the extracted
codec and guard emit exactly what the pre-refactor code emitted, and the write path
still verifies — which is what this criterion asked for. Corroborated the same day
by ticket 13's blanking write and ticket 15's batch run (1 verified copy, 2 skips),
both of which go through the same extracted path.

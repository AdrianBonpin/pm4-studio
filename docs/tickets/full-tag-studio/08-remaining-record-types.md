# 08: Remaining Record types and size accounting

**What to build:** Phone, Email, Contact, SMS, Location, Wi-Fi, Bluetooth, MIME and external-type Records are authored through forms, following the pattern established by Text and URL. Every Record shows its encoded size, and the Draft shows a total, compared against target capacity only where that capacity is known.

**Blocked by:** 07

**Seams:**
- S7 NDEF codec — catches round-trip for each new type and size arithmetic; misses real tag behaviour.

**Tracker:** None
**Status:** done

- [x] Each listed Record type can be authored and round-trips through encode and decode.
- [x] Each Record displays its encoded byte length.
- [x] The Draft displays a total byte count.
- [x] Where target capacity is known the total is compared against it; where unknown the absence is stated rather than guessed.
  - The unknown half is met and shown in the UI: a Draft belongs to no Tag, so the
    Drafts page passes no capacity and `capacityNote(total, null)` states that the total
    is not compared rather than inventing a number.
  - The known half is now met in the write path (ticket 18). `hf_ndef_preview` reads the
    Type 2 Capability Container, `ntag::plan` compares the encoded message's TLV length
    against that capacity, and `capacitySentence` shows it in the confirmation: "The
    message needs N of the tag's C bytes." A message that does not fit is refused with
    `PlanError::TooLarge` before any write frame exists. On hardware a 500-byte message
    (505 bytes of TLV) was refused against 496 with "the message needs 505 bytes and the
    Tag holds 496", and the tag read back unchanged (`docs/PROTOCOL.md`, the `0x0082`
    section). The Draft itself still carries no target Tag, so the comparison happens
    where the target is read rather than on the Drafts page — that is the only place a
    real capacity exists.
- [x] A malformed field is rejected with the problem named instead of being silently encoded.
- [x] Record types that are meaningless from a desktop app are not offered.

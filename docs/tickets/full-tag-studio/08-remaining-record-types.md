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
- [ ] Where target capacity is known the total is compared against it; where unknown the absence is stated rather than guessed.
  - The unknown half is met and shown in the UI: a Draft belongs to no Tag, so the page
    states capacity is not known rather than inventing a number.
  - The known half is unproven end to end. `capacityNote` implements the comparison and
    `drafts.test.ts` covers it, but no Draft carries a target Tag at this stage, so no
    UI path passes a real capacity. Writing a Draft to a Tag is a later gated ticket.
- [x] A malformed field is rejected with the problem named instead of being silently encoded.
- [x] Record types that are meaningless from a desktop app are not offered.

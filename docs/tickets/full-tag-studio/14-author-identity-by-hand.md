# 14: Author an Identity by hand

**What to build:** An Identity is entered as customer, facility and card values, or as raw five-byte hex, validated against the valid ranges, shown before writing, written to a Blank, and optionally kept as a Snapshot in one action. This is what turns the app from a duplicator into a writer.

**Blocked by:** 01, 03

**Seams:**
- S3 Identity codec with S4 Write guard — catches input-to-Identity conversion, validation ranges and the guard; misses whether the device accepts the result.

**Tracker:** None
**Status:** done

- [x] Customer, facility and card-number input produces the same Identity the decoder reports for those values.
- [x] Raw five-byte hex entry is accepted and validated.
- [x] Out-of-range entries are rejected with the valid range shown.
- [x] The exact Identity to be written is shown before the write is sent.
- [x] A successful write can be saved as a Snapshot in one action.
- [x] The write is refused when no tag can be read first.

## Hardware status — VERIFIED 2026-11-22

`cargo run --example authorprobe -- parts 85 0x84 33298`, with a factory-blank
T5577 on the Reader. The values are the ones the decoder reports for the project's
real building Tag, so the round trip is directly checkable.

```
authored id  : 55 00 84 82 12
customer     : 0x55
facility     : 132
card         : 33298
data32       : 0x00848212
payload (24) : 00 01 01 00 00 00 00 00 55 00 00 00 55 00 00 00 12 82 84 00 00 00 00 00
tag before   : tag present as 00 00 00 15 C9 (customer 0x00, facility 0, card 5577)
read-back    : 55 00 84 82 12 (facility 132, card 33298)
outcome      : verified
confirmed    : yes — a confirmed copy
```

What this establishes:

- `from_facility_card` is correct **on hardware**, not merely in tests: the parts
  `85 / 0x84 / 33298` reached the chip as `data32 = 0x00848212` and read back as
  the same Identity the decoder reports for the real Tag.
- The emitted 24-byte payload is byte-identical to the layout captured earlier —
  `[8]` and `[12]` carry the customer, `[16..20]` the little-endian `data32` — so
  ticket 01's codec extraction changed nothing on the wire.
- The write was classified `verified` and counted as a confirmed copy, exercising
  the counting rule of ticket 09 on real hardware.

The read-back also carries a `C8 42` marker after the data field. This is a
device-side artifact, not part of the Identity; the same marker appears in the
original capture of the real building Tag.

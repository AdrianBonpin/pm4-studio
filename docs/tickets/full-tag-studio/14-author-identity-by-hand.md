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

## Hardware status — UNVERIFIED

`cargo run --example authorprobe -- read` / `-- parts` / `-- hex` in
`src-tauri/examples/` exercises the shipping path (the same
`author_identity::from_parts`/`from_hex`, guard and `write_outcome::classify` the
app uses). **It has not been run against a chip.** Ticket 13's run on 2026-11-21
opened the Reader and got replies to wake, HF poll and LF read, but the 125 kHz
field was empty across three runs ("no tag latched") — the same empty field
blocks this ticket. So: `from_facility_card` is proven a true inverse of
`facility()`/`card()` in both directions including the boundaries, the payload is
byte-identical to the captured `55 00 84 82 12` write, but **no authored Identity
has been observed landing on a T5577**. What that leaves open is whether the
device accepts the 24-byte `0x0073` for these values and whether the read-back
matches. Record the probe output here when a Blank is on the Reader.

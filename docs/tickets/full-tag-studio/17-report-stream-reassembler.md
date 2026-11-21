# 17: Report stream reassembler

**What to build:** Responses that span several USB reports are reconstructed into complete frames instead of being truncated, so that long tag responses can be parsed at all. Single-report responses continue to behave exactly as before.

**Blocked by:** 16

**Seams:**
- S2 Report stream reassembler — catches multi-report reconstruction, partial frames and desynchronisation; misses whether the hardware really emits responses this way, which ticket 16 observed.

**Tracker:** None
**Status:** done

- [x] A response delivered across several reports is reconstructed into one frame.
- [x] A frame split at each possible report boundary still parses.
- [x] A stream containing an unknown or malformed segment resynchronises instead of wedging.
- [x] Single-report responses behave exactly as they do today.
- [x] Every previously captured frame still parses identically.
- [x] A declared length larger than the bytes actually received is reported as an error rather than silently truncated.

## Implementation note — seam S2

`src-tauri/src/stream.rs` is the pure seam: `ReportStream::push` takes reports,
`next_frame` yields whole frames by `5 + LEN + 2` from the `0x55` magic, and
`take_error` names a frame that stopped short once no more bytes are coming.
Nothing in it touches a `HidDevice`, so multi-report reconstruction, every split
boundary, desynchronisation and truncation are all unit-tested against recorded
bytes from `test_frames.rs` plus the verified `0x0081` frame shape from
docs/PROTOCOL.md.

`Reader::read_one` is now a thin loop over that stream: it reads a report, pushes
it, and asks for a frame. `Reader::drain` clears the stream as well as the queue,
because a half frame left behind would be spliced onto the next reply. The
outbound half is `stream::encode_frame` (any payload length, checksum over
`len & 0xFF` bytes as the firmware requires) plus `stream::split_reports`, and
`Reader::write_frame_bytes` sends those reports back to back — a 24-byte LF
payload is still exactly one report, a 1335-byte NTAG write is 21.

The `len & 0xFF` checksum truncation is deliberately reproduced, not "fixed":
the spike showed a whole-payload checksum gets no reply at all.

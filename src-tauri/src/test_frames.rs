//! Real frames captured from the Reader, shared by the unit tests.
//!
//! Every constant here is verbatim capture data, not something the code under
//! test produced. Tests assert against these so a decode or encode regression
//! shows up as a diff against hardware, not as agreement with itself.
//!
//! Sources:
//!   - `LF_READ_CARD_PRESENT` / `LF_READ_NO_CARD` — captured from the physical
//!     Reader while this app was already reading 125 kHz tags.
//!   - `LF_WRITE_CONFIRMED` / `LF_WRITE_READBACK` — the working example recorded
//!     in docs/PROTOCOL.md under `0x0073`, confirmed on hardware by writing a
//!     tag and reading it back byte-identically.

/// 125 kHz read, tag latched. Identity `56 00 53 C7 B3`.
pub const LF_READ_CARD_PRESENT: &str =
    "55 00 72 00 18 00 01 01 00 00 00 00 00 56 00 00 00 b3 c7 53 00 00 00 c8 42 00 00 00 00 04 fb";

/// 125 kHz read with nothing on the Reader (validity flag clear).
pub const LF_READ_NO_CARD: &str =
    "55 00 72 00 18 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 C8 42 00 00 00 00 74 8B";

/// The 24-byte write payload the device accepted, inside a full frame. The
/// capture in docs/PROTOCOL.md records the payload and leaves the checksum as a
/// placeholder; the frame here is that payload wrapped by the verified rule.
pub const LF_WRITE_CONFIRMED: &str =
    "55 00 73 00 18 00 01 01 00 00 00 00 00 55 00 00 00 55 00 00 00 12 82 84 00 00 00 00 00 eb 14";

/// Read-back of the tag written by `LF_WRITE_CONFIRMED`. Identity `55 00 84 82 12`.
pub const LF_WRITE_READBACK: &str =
    "55 00 72 00 18 00 01 01 00 00 00 00 00 55 00 00 00 12 82 84 00 00 00 C8 42 01 00 00 00 35 ca";

/// Decode a stored frame's hex into its payload, asserting the frame itself is
/// one we understand and that its checksum verifies.
pub fn payload(frame_hex: &str) -> Vec<u8> {
    let raw = crate::reader::parse_hex(frame_hex).expect("fixture is valid hex");
    let frame = crate::reader::parse_frame(&raw).expect("fixture parses as a frame");
    assert!(frame.checksum_ok, "fixture checksum must verify: {frame_hex}");
    frame.payload
}

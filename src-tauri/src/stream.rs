//! S2 — report stream reassembler.
//!
//! USB HID delivers at most 64 bytes per report, but a frame is a *continuous
//! byte stream* split every 64 bytes: continuation reports carry no header and
//! no per-report padding, so report 2 simply opens with the next payload byte.
//! See docs/PROTOCOL.md, "Multi-report frames — VERIFIED (spike 16)".
//!
//! Everything here is pure: reports in, frames out. No `HidDevice`, no
//! timeouts, no sleeps, which is what makes multi-report reconstruction
//! testable without hardware.

use crate::reader::{xor_checksum, Frame, MAGIC, REPORT_LEN};

/// Largest declared payload length this reassembler will wait for.
///
/// The longest frame the firmware is known to send is the `0x0081` memory read
/// (1284 payload bytes) and the longest it accepts is the `0x0082` write (1328).
/// A `0x55` whose header declares more than this is a false magic inside a
/// broken segment, not a frame, so it is skipped instead of stalling the stream
/// for 64 KiB of bytes that will never arrive.
pub const MAX_PAYLOAD_LEN: usize = 4096;

/// Why the stream stopped mid-frame when no more bytes were coming.
///
/// A declared length longer than the bytes that actually arrived is a
/// truncated response; the caller must see an error rather than a frame with a
/// silently shortened payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamError {
    /// A header arrived and declared more payload than ever did.
    TruncatedFrame {
        cmd: u16,
        declared_len: usize,
        received: usize,
    },
    /// Fewer than a header's worth of bytes arrived and then the stream
    /// stopped; the command id is not even known.
    TruncatedHeader { received: usize },
}

impl std::fmt::Display for StreamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StreamError::TruncatedFrame {
                cmd,
                declared_len,
                received,
            } => write!(
                f,
                "the reader's 0x{cmd:04X} response is truncated: the frame declares \
                 {declared_len} payload bytes and {needed} payload-and-checksum bytes in \
                 total, but only {received} arrived after the header",
                needed = declared_len + 2
            ),
            StreamError::TruncatedHeader { received } => write!(
                f,
                "the reader's response is truncated: it stopped after {received} bytes, \
                 before a frame header was complete"
            ),
        }
    }
}

impl std::error::Error for StreamError {}

/// Accumulates reports and hands back whole frames.
#[derive(Debug, Default, Clone)]
pub struct ReportStream {
    buf: Vec<u8>,
}

impl ReportStream {
    pub fn new() -> Self {
        Self::default()
    }

    /// Append one report exactly as read from the Reader.
    pub fn push(&mut self, report: &[u8]) {
        self.buf.extend_from_slice(report);
    }

    /// Bytes held back because they were not yet a whole frame.
    pub fn buffered(&self) -> usize {
        self.buf.len()
    }

    pub fn clear(&mut self) {
        self.buf.clear();
    }

    /// The next whole frame, or `None` when the buffer holds nothing that is
    /// complete yet (or nothing that looks like a frame at all).
    ///
    /// Garbage is skipped until the next `0x55`, so an unknown or malformed
    /// segment resynchronises instead of wedging the stream. A frame whose
    /// checksum does not verify is still returned, with `checksum_ok` false,
    /// exactly as a single-report frame was before this module existed.
    pub fn next_frame(&mut self) -> Option<Frame> {
        loop {
            let magic = match self.buf.iter().position(|&b| b == MAGIC) {
                Some(pos) => pos,
                None => {
                    self.buf.clear();
                    return None;
                }
            };
            if magic > 0 {
                self.buf.drain(..magic);
            }
            if self.buf.len() < 5 {
                return None;
            }

            let cmd = be16(&self.buf[1..3]);
            let len = be16(&self.buf[3..5]) as usize;
            if len > MAX_PAYLOAD_LEN {
                // A length no command in this protocol declares: the 0x55 was
                // payload noise or a stale byte, not a header. Step over it.
                self.buf.drain(..1);
                continue;
            }

            let total = 5 + len + 2;
            if self.buf.len() < total {
                // Not enough bytes yet. If a whole, checksum-valid frame starts
                // later in the buffer then this header can never complete: it is
                // a false magic inside a broken segment, so resynchronise to the
                // real frame instead of waiting forever.
                if let Some(pos) = self.first_complete_frame_after(1) {
                    self.buf.drain(..pos);
                    continue;
                }
                return None;
            }

            let payload = self.buf[5..5 + len].to_vec();
            let (c0, c1) = xor_checksum(&payload, Some(len & 0xFF));
            let checksum_ok = self.buf[5 + len] == c0 && self.buf[6 + len] == c1;
            self.buf.drain(..total);
            return Some(Frame {
                cmd,
                payload,
                checksum_ok,
            });
        }
    }

    /// Whatever is left when no more reports are coming, if it is a frame that
    /// was cut short. Clears the buffer: a truncated frame is never resumed
    /// later, because the next reply starts a new stream.
    ///
    /// Bytes that never formed even the start of a frame are not a truncation;
    /// they are the padding or noise the resynchroniser already knows to drop.
    pub fn take_error(&mut self) -> Option<StreamError> {
        let error = if self.buf.first() != Some(&MAGIC) {
            None
        } else if self.buf.len() < 5 {
            Some(StreamError::TruncatedHeader {
                received: self.buf.len(),
            })
        } else {
            let len = be16(&self.buf[3..5]) as usize;
            let total = 5 + len + 2;
            if self.buf.len() < total {
                Some(StreamError::TruncatedFrame {
                    cmd: be16(&self.buf[1..3]),
                    declared_len: len,
                    // Bytes that did arrive after the header, which includes a
                    // partial checksum when the payload was complete.
                    received: self.buf.len() - 5,
                })
            } else {
                None
            }
        };
        self.buf.clear();
        error
    }

    /// Offset of the first whole frame that starts at or after `from` and whose
    /// checksum verifies. Used only to resynchronise past a broken segment.
    fn first_complete_frame_after(&self, from: usize) -> Option<usize> {
        let mut i = from;
        while i + 5 <= self.buf.len() {
            if self.buf[i] == MAGIC {
                let len = be16(&self.buf[i + 3..i + 5]) as usize;
                let total = 5 + len + 2;
                if len <= MAX_PAYLOAD_LEN && i + total <= self.buf.len() {
                    let payload = &self.buf[i + 5..i + 5 + len];
                    let (c0, c1) = xor_checksum(payload, Some(len & 0xFF));
                    if self.buf[i + 5 + len] == c0 && self.buf[i + 6 + len] == c1 {
                        return Some(i);
                    }
                }
            }
            i += 1;
        }
        None
    }
}

/// Encode a command frame of any payload length, checksum included.
///
/// The checksum follows the firmware: XOR over the first `len & 0xFF` payload
/// bytes only. That truncation is not a bug to fix — the spike confirmed a
/// 1328-byte payload checksummed over all of it got **no reply at all**, while
/// the `len & 0xFF` checksum was accepted.
///
/// Unlike [`crate::reader::make_frame`] this is not limited to one report; the
/// result is padded into reports by [`split_reports`].
pub fn encode_frame(cmd: u16, payload: &[u8]) -> Vec<u8> {
    assert!(
        payload.len() <= u16::MAX as usize,
        "payload too long for the declared-length field"
    );
    let mut frame = Vec::with_capacity(5 + payload.len() + 2);
    frame.push(MAGIC);
    frame.push((cmd >> 8) as u8);
    frame.push((cmd & 0xFF) as u8);
    frame.push((payload.len() >> 8) as u8);
    frame.push((payload.len() & 0xFF) as u8);
    frame.extend_from_slice(payload);
    let (c0, c1) = xor_checksum(payload, Some(payload.len() & 0xFF));
    frame.push(c0);
    frame.push(c1);
    frame
}

/// Split an encoded frame into 64-byte reports, zero-padding the last one.
///
/// This is the outbound half of the same rule: the firmware reads a continuous
/// byte stream and gives up if reports are more than ~64 ms apart, so reports
/// are written back to back.
pub fn split_reports(frame: &[u8]) -> Vec<[u8; REPORT_LEN]> {
    let mut reports = Vec::with_capacity(frame.len().div_ceil(REPORT_LEN));
    for chunk in frame.chunks(REPORT_LEN) {
        let mut report = [0u8; REPORT_LEN];
        report[..chunk.len()].copy_from_slice(chunk);
        reports.push(report);
    }
    reports
}

fn be16(bytes: &[u8]) -> u16 {
    ((bytes[0] as u16) << 8) | bytes[1] as u16
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader::{hex, parse_frame, parse_hex};
    use crate::test_frames;

    /// A captured frame trimmed to its declared length, i.e. without the
    /// 64-byte report's zero padding.
    fn captured_frame(frame_hex: &str) -> Vec<u8> {
        let raw = parse_hex(frame_hex).expect("fixture is valid hex");
        let len = be16(&raw[3..5]) as usize;
        raw[..5 + len + 2].to_vec()
    }

    fn all_captures() -> [(&'static str, &'static str); 4] {
        [
            ("LF_READ_CARD_PRESENT", test_frames::LF_READ_CARD_PRESENT),
            ("LF_READ_NO_CARD", test_frames::LF_READ_NO_CARD),
            ("LF_WRITE_CONFIRMED", test_frames::LF_WRITE_CONFIRMED),
            ("LF_WRITE_READBACK", test_frames::LF_WRITE_READBACK),
        ]
    }

    /// Feed `bytes` as reports of `chunk` bytes and return every whole frame.
    fn frames_from(bytes: &[u8], chunk: usize) -> (Vec<Frame>, ReportStream) {
        let mut stream = ReportStream::new();
        let mut frames = Vec::new();
        for part in bytes.chunks(chunk) {
            stream.push(part);
            while let Some(frame) = stream.next_frame() {
                frames.push(frame);
            }
        }
        (frames, stream)
    }

    fn assert_same_frame(captured: &str, got: &Frame) {
        let raw = parse_hex(captured).expect("fixture is valid hex");
        let expected = parse_frame(&raw).expect("fixture parses as a frame");
        assert_eq!(got.cmd, expected.cmd, "command id differs for {captured}");
        assert_eq!(got.payload, expected.payload, "payload differs for {captured}");
        assert_eq!(
            got.checksum_ok, expected.checksum_ok,
            "checksum verdict differs for {captured}"
        );
        assert!(got.checksum_ok, "captured frame checksum must verify");
    }

    // ---- single-report behaviour must not change ------------------------

    #[test]
    fn a_single_report_frame_parses_exactly_as_before() {
        // The 125 kHz read reply is 31 bytes inside a 64-byte report.
        let mut report = [0u8; REPORT_LEN];
        let frame = captured_frame(test_frames::LF_READ_CARD_PRESENT);
        report[..frame.len()].copy_from_slice(&frame);

        let mut stream = ReportStream::new();
        stream.push(&report);

        let got = stream.next_frame().expect("one complete frame");
        assert_same_frame(test_frames::LF_READ_CARD_PRESENT, &got);
        assert_eq!(got.payload.len(), 24);
        assert!(stream.next_frame().is_none(), "padding is not a frame");
        assert_eq!(stream.take_error(), None, "frame padding is not a truncation");
    }

    #[test]
    fn the_hf_poll_and_version_shapes_still_parse() {
        // 0x0054 with its 17-byte payload: 24-byte frame in one report.
        let payload = parse_hex("48 30 30 53 30 37 00 00 00 00 00 00 00 00 00 00 01").unwrap();
        let frame = encode_frame(0x0054, &payload);
        let reports = split_reports(&frame);
        assert_eq!(reports.len(), 1, "version reply fits in one report");

        let mut stream = ReportStream::new();
        stream.push(&reports[0]);
        let got = stream.next_frame().expect("version frame");
        assert_eq!(got.cmd, 0x0054);
        assert_eq!(got.payload, payload);
        assert!(got.checksum_ok);
    }

    #[test]
    fn every_previously_captured_frame_parses_identically() {
        for (name, captured) in all_captures() {
            let frame = captured_frame(captured);
            let mut report = [0u8; REPORT_LEN];
            report[..frame.len()].copy_from_slice(&frame);

            let mut stream = ReportStream::new();
            stream.push(&report);
            let got = stream.next_frame().unwrap_or_else(|| panic!("{name} did not parse"));
            assert_same_frame(captured, &got);
            assert_eq!(stream.take_error(), None, "{name} left a truncation");
        }
    }

    #[test]
    fn a_bad_checksum_is_still_returned_with_the_verdict_false() {
        let frame = captured_frame(test_frames::LF_READ_CARD_PRESENT);
        let mut corrupt = frame.clone();
        let last = corrupt.len() - 1;
        corrupt[last] ^= 0xFF;

        let mut stream = ReportStream::new();
        stream.push(&corrupt);
        let got = stream.next_frame().expect("frame shape is intact");
        assert!(!got.checksum_ok, "a wrong checksum is reported, not hidden");
        assert_eq!(got.payload.len(), 24);
    }

    // ---- multi-report reconstruction ------------------------------------

    /// The `0x0081` memory-read reply from docs/PROTOCOL.md: status dword, 256
    /// pages of 4 bytes, 256 page states, and a `FF 00` checksum because
    /// `1284 & 0xFF = 4` and the XOR over the four zero status bytes is zero.
    fn ntag_read_frame() -> Vec<u8> {
        let mut payload = vec![0u8; 4 + 1024 + 256];
        // Mark two pages so the reconstruction is checkable byte for byte.
        payload[4..8].copy_from_slice(&[0x04, 0x43, 0x8A, 0x45]);
        payload[8..12].copy_from_slice(&[0x01, 0x22, 0x09, 0x03]);
        payload[0x404] = 1;
        payload[0x405] = 1;
        let frame = encode_frame(0x0081, &payload);
        assert_eq!(frame.len(), 1291, "verified: the read reply frame is 1291 bytes");
        assert_eq!(&frame[frame.len() - 2..], &[0xFF, 0x00], "verified terminator");
        frame
    }

    #[test]
    fn a_frame_delivered_across_many_reports_is_one_frame() {
        let frame = ntag_read_frame();
        let reports = split_reports(&frame);
        assert_eq!(reports.len(), 21, "verified: the read reply arrives as 21 reports");

        let (frames, mut stream) = frames_from(&frame, REPORT_LEN);
        assert_eq!(frames.len(), 1, "21 reports are one frame, not 21");
        let got = &frames[0];
        assert_eq!(got.cmd, 0x0081);
        assert_eq!(got.payload.len(), 1284);
        assert!(got.checksum_ok);
        assert_eq!(&got.payload[4..12], &[0x04, 0x43, 0x8A, 0x45, 0x01, 0x22, 0x09, 0x03]);
        assert_eq!(&got.payload[0x404..0x406], &[1, 1]);
        assert_eq!(stream.take_error(), None);
    }

    #[test]
    fn the_last_report_of_a_long_reply_may_be_short() {
        // 1291 = 20 * 64 + 11: nine payload bytes plus the FF 00 checksum.
        let frame = ntag_read_frame();
        let mut reports = split_reports(&frame);
        let last = reports.pop().unwrap();
        assert_eq!(last[..11], frame[1280..]);

        let (frames, mut stream) = frames_from(&frame, 64);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].payload.len(), 1284);
        assert!(stream.take_error().is_none());
    }

    #[test]
    fn a_frame_split_at_every_possible_boundary_still_parses() {
        let mut exercised: Vec<(&str, usize)> = Vec::new();
        for (name, captured) in all_captures() {
            let frame = captured_frame(captured);
            for split in 1..frame.len() {
                let mut stream = ReportStream::new();
                stream.push(&frame[..split]);
                assert!(
                    stream.next_frame().is_none(),
                    "{name}: split at {split} must not yield a partial frame"
                );
                assert_eq!(
                    stream.buffered(),
                    split,
                    "{name}: split at {split} keeps the partial frame for the next report"
                );

                // The stream is paused mid-frame, not ended: the rest of the
                // frame arriving as the next report completes it.
                stream.push(&frame[split..]);
                let got = stream
                    .next_frame()
                    .unwrap_or_else(|| panic!("{name}: split at {split} did not reassemble"));
                assert_same_frame(captured, &got);
                assert_eq!(stream.buffered(), 0, "{name}: split at {split} left bytes");
                exercised.push((name, split));
            }
        }

        // The split points exercised are exactly every interior byte of every
        // captured frame, each one once: 4 frames x 30 splits = 120.
        for (name, captured) in all_captures() {
            let len = captured_frame(captured).len();
            let got: Vec<usize> = exercised
                .iter()
                .filter(|(n, _)| *n == name)
                .map(|(_, split)| *split)
                .collect();
            assert_eq!(got, (1..len).collect::<Vec<_>>(), "{name}: every split ran once");
        }
        assert_eq!(exercised.len(), 30 + 30 + 30 + 30, "all 120 captured split points ran");
    }

    #[test]
    fn the_21_report_reply_survives_a_split_at_every_report_boundary() {
        let frame = ntag_read_frame();
        let mut exercised: Vec<(usize, usize)> = Vec::new();
        for split in 1..frame.len() {
            // Feed the frame as two reports split at `split`, then in 64-byte
            // reports with the same split as a third boundary. Both shapes must
            // reconstruct the identical frame.
            for chunk in [split, 64] {
                let (frames, mut stream) = frames_from(&frame, chunk);
                assert_eq!(frames.len(), 1, "chunk {chunk} split {split}: one frame");
                assert_eq!(frames[0].payload, frame[5..5 + 1284].to_vec());
                assert!(frames[0].checksum_ok);
                assert_eq!(stream.take_error(), None);
                exercised.push((split, chunk));
            }
        }

        let expected: Vec<(usize, usize)> = (1..frame.len())
            .flat_map(|split| [(split, split), (split, REPORT_LEN)])
            .collect();
        assert_eq!(exercised, expected, "every split ran in both report shapes");

        // The 20 real report boundaries of the verified 21-report reply are a
        // subset of the split points that just passed.
        let boundaries: Vec<usize> = (REPORT_LEN..frame.len()).step_by(REPORT_LEN).collect();
        assert_eq!(boundaries.len(), 20, "20 full reports before the short last one");
        for boundary in boundaries {
            assert!(
                exercised.contains(&(boundary, boundary)),
                "report boundary {boundary} was split and reassembled"
            );
        }
    }

    #[test]
    fn a_report_holding_the_tail_and_the_start_of_the_next_frame_parses_both() {
        // Frames are zero padded when they travel alone, but a stream can carry
        // the tail of one frame and the head of the next in the same report.
        let first = encode_frame(0x0085, &[0, 1, 0x04, 0x43, 0x8A, 0x45]);
        let second = encode_frame(0x0085, &[1, 1, 0x01, 0x22, 0x09, 0x03]);
        let mut bytes = first.clone();
        bytes.extend_from_slice(&second);

        let mut stream = ReportStream::new();
        stream.push(&bytes);
        let a = stream.next_frame().expect("first frame");
        let b = stream.next_frame().expect("second frame");
        assert_eq!((a.cmd, a.payload[0]), (0x0085, 0));
        assert_eq!((b.cmd, b.payload[0]), (0x0085, 1));
        assert!(stream.next_frame().is_none());
        assert_eq!(stream.take_error(), None);
    }

    // ---- desynchronisation ----------------------------------------------

    #[test]
    fn an_unknown_segment_resynchronises_to_the_next_frame() {
        // Garbage that contains no magic byte at all.
        let mut bytes = vec![0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01];
        bytes.extend_from_slice(&captured_frame(test_frames::LF_READ_CARD_PRESENT));

        let mut stream = ReportStream::new();
        stream.push(&bytes);
        let got = stream.next_frame().expect("real frame after garbage");
        assert_same_frame(test_frames::LF_READ_CARD_PRESENT, &got);
        assert_eq!(stream.take_error(), None);
    }

    #[test]
    fn garbage_between_frames_does_not_wedge_the_stream() {
        let good = captured_frame(test_frames::LF_READ_CARD_PRESENT);
        let mut bytes = good.clone();
        bytes.extend_from_slice(&[0x00; 20]);
        bytes.extend_from_slice(&good);

        let mut stream = ReportStream::new();
        stream.push(&bytes);
        let a = stream.next_frame().expect("first frame");
        let b = stream.next_frame().expect("frame after garbage");
        assert_eq!(a.payload, b.payload);
        assert!(b.checksum_ok);
        assert_eq!(stream.take_error(), None);
    }

    #[test]
    fn a_false_magic_with_an_impossible_length_is_skipped() {
        // 0x55 then a length of 0xFFFF: no command in this protocol declares
        // that, so it is noise rather than a frame to wait for.
        let mut bytes = vec![0x55, 0x00, 0x83, 0xFF, 0xFF, 0x11, 0x22];
        bytes.extend_from_slice(&captured_frame(test_frames::LF_READ_CARD_PRESENT));

        let mut stream = ReportStream::new();
        stream.push(&bytes);
        let got = stream.next_frame().expect("real frame after false magic");
        assert_same_frame(test_frames::LF_READ_CARD_PRESENT, &got);
        assert_eq!(stream.take_error(), None);
    }

    #[test]
    fn a_truncated_segment_before_a_whole_frame_resynchronises() {
        // A 0x55 that declares 255 payload bytes, then a whole valid frame. The
        // broken segment can never complete, so the real frame must be found.
        let mut bytes = vec![0x55, 0x00, 0x83, 0x00, 0xFF, 0x01, 0x02];
        bytes.extend_from_slice(&captured_frame(test_frames::LF_READ_CARD_PRESENT));

        let mut stream = ReportStream::new();
        stream.push(&bytes);
        let got = stream.next_frame().expect("whole frame wins over a broken header");
        assert_same_frame(test_frames::LF_READ_CARD_PRESENT, &got);
    }

    #[test]
    fn a_frame_with_an_unseen_command_id_is_not_rejected() {
        let frame = encode_frame(0x1234, &[1, 2, 3]);
        let mut stream = ReportStream::new();
        stream.push(&frame);
        let got = stream.next_frame().expect("unknown commands still parse");
        assert_eq!(got.cmd, 0x1234);
        assert_eq!(got.payload, vec![1, 2, 3]);
    }

    // ---- truncation is an error, never a short payload ------------------

    #[test]
    fn a_declared_length_longer_than_the_bytes_received_is_an_error() {
        let frame = ntag_read_frame();
        let mut stream = ReportStream::new();
        // One report only: header plus 59 of 1284 payload bytes.
        stream.push(&frame[..REPORT_LEN]);
        assert!(stream.next_frame().is_none(), "59 of 1284 bytes is not a frame");
        assert_eq!(
            stream.take_error(),
            Some(StreamError::TruncatedFrame {
                cmd: 0x0081,
                declared_len: 1284,
                received: 59,
            })
        );
        assert_eq!(stream.buffered(), 0, "a truncated frame is not resumed later");
    }

    #[test]
    fn a_cut_off_header_is_reported_too() {
        let mut stream = ReportStream::new();
        stream.push(&[0x55, 0x00, 0x83]);
        assert_eq!(
            stream.take_error(),
            Some(StreamError::TruncatedHeader { received: 3 })
        );
    }

    #[test]
    fn a_header_and_payload_without_the_checksum_is_an_error() {
        let frame = captured_frame(test_frames::LF_READ_CARD_PRESENT);
        let mut stream = ReportStream::new();
        stream.push(&frame[..frame.len() - 1]);
        assert!(stream.next_frame().is_none());
        assert_eq!(
            stream.take_error(),
            Some(StreamError::TruncatedFrame {
                cmd: 0x0072,
                declared_len: 24,
                received: 25,
            })
        );
    }

    #[test]
    fn nothing_buffered_is_not_an_error() {
        let mut stream = ReportStream::new();
        assert_eq!(stream.take_error(), None);
        stream.push(&[0x00; 30]);
        assert_eq!(stream.take_error(), None, "pure padding is not a truncation");
    }

    // ---- outbound chunking ----------------------------------------------

    #[test]
    fn a_small_outbound_frame_is_one_zero_padded_report() {
        let reports = split_reports(&encode_frame(0x0073, &[0xAA; 24]));
        assert_eq!(reports.len(), 1);
        assert_eq!(&reports[0][..31], &encode_frame(0x0073, &[0xAA; 24])[..]);
        assert_eq!(&reports[0][31..], &[0u8; 33]);
    }

    #[test]
    fn a_large_outbound_frame_is_chunked_into_64_byte_reports() {
        // The verified 0x0082 write: 1328 payload bytes, a 1335-byte frame,
        // sent as 21 reports of 64 bytes with the last one zero padded.
        let payload = vec![0xFFu8; 1328];
        let frame = encode_frame(0x0082, &payload);
        assert_eq!(frame.len(), 1335);
        assert_eq!(&frame[..5], &[0x55, 0x00, 0x82, 0x05, 0x30]);

        let reports = split_reports(&frame);
        assert_eq!(reports.len(), 21);
        assert!(reports.iter().all(|r| r.len() == REPORT_LEN));
        // 1335 = 20 * 64 + 55, so the last report carries 55 frame bytes and
        // the remaining 9 bytes are the zero padding.
        assert_eq!(&reports[20][..55], &frame[1280..]);
        assert_eq!(&reports[20][55..], &[0u8; 9], "last report is zero padded");

        // The stream on the other side reconstructs it byte for byte, which is
        // how the firmware reads it.
        let (frames, _) = frames_from(&frame, REPORT_LEN);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].cmd, 0x0082);
        assert_eq!(frames[0].payload.len(), 1328);
    }

    #[test]
    fn the_outbound_checksum_covers_only_len_and_0xff_bytes() {
        // 1328 & 0xFF = 48, so only the first 48 payload bytes are covered.
        let mut payload = vec![0u8; 1328];
        payload[0] = 0xFF;
        payload[8] = 0x05;
        payload[100] = 0xAA; // beyond the covered window: must not matter
        payload[1327] = 0x55;

        let frame = encode_frame(0x0082, &payload);
        let covered = xor_checksum(&payload[..48], None);
        assert_eq!(&frame[frame.len() - 2..], &[covered.0, covered.1]);

        // Checksumming the whole payload, which the firmware ignores, is a
        // different pair (the spike saw FB 04 accepted and DB 24 unanswered).
        let whole = xor_checksum(&payload, None);
        assert_ne!(&frame[frame.len() - 2..], &[whole.0, whole.1]);
    }

    #[test]
    fn an_encoded_frame_reports_its_own_bytes_in_hex() {
        let frame = encode_frame(0x0051, &[0x01]);
        assert_eq!(hex(&frame), "55 00 51 00 01 01 FE 01");
    }
}

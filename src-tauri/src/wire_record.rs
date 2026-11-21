//! Verbatim recordings of what crossed the USB HID channel.
//!
//! A probe answers a question about the protocol, so its transcript has to be
//! the bytes that went over the wire rather than a re-derivation of them.
//! [`Wire`] is one entry of a recording, and [`crate::reader::Reader`] keeps the
//! log while a recording runs: every frame it hands to the device and every
//! report it reads back. Nothing here touches a `HidDevice`; the log is cut into
//! frames, labelled and laid out by field here, which is what makes a transcript
//! checkable without a Tag and testable without hardware.
//!
//! The distinction this module refuses to blur: an `Out` entry is the exact
//! frame that was written, and an `In` entry is the exact report that arrived.
//! Anything derived from those bytes is labelled as derived where it is printed
//! (the checksum's validity, the report arithmetic, the field layout).

use crate::ntag::{
    CMD_NTAG_PAGE, PAGE_COUNT, PAGE_LEN, STATE_WRITE, USER_FIRST_PAGE, WRITE_PAYLOAD_LEN,
};
use crate::reader::{hex, xor_checksum, MAGIC, REPORT_LEN};
use crate::stream::MAX_PAYLOAD_LEN;

/// One thing that crossed the USB HID channel, in the order it crossed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Wire {
    /// A whole frame handed to the device, before 64-byte report chunking.
    Out(Vec<u8>),
    /// One report read from the device, exactly as it arrived.
    In(Vec<u8>),
    /// The transport reset its reassembler here: whatever it was holding was
    /// thrown away. Bytes either side of a break are never spliced into one
    /// frame, so a truncated reply cannot be printed as if it were whole.
    Break,
}

/// Which way a frame travelled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Host to reader.
    Out,
    /// Reader to host.
    In,
}

impl Direction {
    /// The label a transcript uses.
    pub fn as_str(self) -> &'static str {
        match self {
            Direction::Out => "OUT",
            Direction::In => "IN",
        }
    }
}

/// Reports a frame of `total` bytes occupies on the wire: `ceil(total / 64)`.
///
/// A 64-byte report is the transport's unit, not the frame's: a 1335-byte write
/// frame is 21 reports with 9 zero bytes of padding in the last one.
pub fn report_count(total: usize) -> usize {
    total.div_ceil(REPORT_LEN)
}

/// One frame, cut out of a stream, with its header fields as they arrived.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawFrame {
    /// Header, payload and checksum exactly as they crossed the wire.
    pub bytes: Vec<u8>,
    pub cmd: u16,
    /// The length the header declares, before any clamping.
    pub declared_len: usize,
    /// The two checksum bytes as they arrived, `(x ^ 0xFF, x)`.
    pub checksum: (u8, u8),
    /// Those two bytes against the XOR rule, truncated to `len & 0xFF`.
    ///
    /// Derived from the bytes above, never assumed: a reply whose checksum does
    /// not verify is still handed on, with this `false`, exactly as
    /// `stream::ReportStream` does.
    pub checksum_ok: bool,
}

impl RawFrame {
    /// Frame bytes on the wire: header plus payload plus checksum.
    pub fn total(&self) -> usize {
        self.bytes.len()
    }

    /// Reports this frame occupies, from its byte count.
    pub fn reports(&self) -> usize {
        report_count(self.bytes.len())
    }

    /// The payload, byte for byte.
    pub fn payload(&self) -> &[u8] {
        &self.bytes[5..5 + self.declared_len]
    }
}

/// Cuts one direction's byte stream into frames as the bytes arrive.
///
/// A frame is a continuous byte stream split every 64 bytes (see
/// `stream::ReportStream`, whose rules this repeats for recorded bytes), so the
/// cutter is fed reports one at a time and hands back whatever frames that
/// report completed. Bytes that are not a frame — the zero padding of a last
/// report, a stale echo — are skipped, and a frame that never finished stays in
/// [`Self::leftover`] so a truncated reply is visible rather than invisible.
#[derive(Debug, Default, Clone)]
pub struct FrameCutter {
    buf: Vec<u8>,
}

impl FrameCutter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed bytes; returns every frame this input completed.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<RawFrame> {
        self.buf.extend_from_slice(bytes);
        let mut frames = Vec::new();
        loop {
            let Some(magic) = self.buf.iter().position(|&b| b == MAGIC) else {
                // Nothing here starts a frame: padding or noise, not a truncation.
                self.buf.clear();
                return frames;
            };
            if magic > 0 {
                self.buf.drain(..magic);
            }
            if self.buf.len() < 5 {
                return frames;
            }
            let declared_len = ((self.buf[3] as usize) << 8) | self.buf[4] as usize;
            if declared_len > MAX_PAYLOAD_LEN {
                // A length no command in this protocol declares: the magic was
                // payload noise, so step over it rather than wait for a frame
                // that can never arrive.
                self.buf.drain(..1);
                continue;
            }
            let total = 5 + declared_len + 2;
            if self.buf.len() < total {
                return frames;
            }
            let bytes: Vec<u8> = self.buf[..total].to_vec();
            let c0 = bytes[5 + declared_len];
            let c1 = bytes[6 + declared_len];
            let cmd = ((bytes[1] as u16) << 8) | bytes[2] as u16;
            let checksum_ok =
                xor_checksum(&bytes[5..5 + declared_len], Some(declared_len & 0xFF)) == (c0, c1);
            self.buf.drain(..total);
            frames.push(RawFrame {
                bytes,
                cmd,
                declared_len,
                checksum: (c0, c1),
                checksum_ok,
            });
        }
    }

    /// Bytes held back because they never completed a frame.
    pub fn leftover(&self) -> &[u8] {
        &self.buf
    }
}

/// One entry of a replayed recording, in the order it crossed the wire.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Logged {
    /// A whole frame, in the direction it travelled.
    Frame {
        direction: Direction,
        frame: RawFrame,
    },
    /// The transport reset its reassembler here, discarding `discarded` bytes
    /// that never became a whole frame.
    Reset { discarded: usize },
}

/// Replay a recording as an ordered, direction-labelled frame list.
///
/// The log is already in wire order; this only assembles the reports into
/// frames. Kept as one list so a transcript can show a request next to the reply
/// that answered it, instead of two piles that have to be lined up by hand.
pub fn replay(recording: &[Wire]) -> Vec<Logged> {
    let mut out = FrameCutter::new();
    let mut inbound = FrameCutter::new();
    let mut logged = Vec::new();
    for wire in recording {
        match wire {
            Wire::Out(frame) => {
                for frame in out.push(frame) {
                    logged.push(Logged::Frame {
                        direction: Direction::Out,
                        frame,
                    });
                }
            }
            Wire::In(report) => {
                for frame in inbound.push(report) {
                    logged.push(Logged::Frame {
                        direction: Direction::In,
                        frame,
                    });
                }
            }
            Wire::Break => {
                let discarded = out.leftover().len() + inbound.leftover().len();
                out = FrameCutter::new();
                inbound = FrameCutter::new();
                logged.push(Logged::Reset { discarded });
            }
        }
    }
    logged
}

/// The one-line summary of a frame: the shape docs/PROTOCOL.md pastes.
///
/// `IN  0x0085  len=0x0006  cksum=07 F8 ok  total=13 bytes  1 report`
pub fn frame_line(direction: Direction, frame: &RawFrame) -> String {
    let (c0, c1) = frame.checksum;
    let reports = frame.reports();
    format!(
        "{dir:<3} 0x{cmd:04X}  len=0x{len:04X}  cksum={c0:02X} {c1:02X} {ok:<3}  total={total} bytes  {reports} {noun}",
        dir = direction.as_str(),
        cmd = frame.cmd,
        len = frame.declared_len,
        ok = if frame.checksum_ok { "ok" } else { "BAD" },
        total = frame.total(),
        noun = if reports == 1 { "report" } else { "reports" },
    )
}

/// `bytes` as hex lines of `per_line` bytes, no prefix.
///
/// Wrapped rather than one 4 KB line so the 1335-byte write request is readable
/// and diffable, and so a transcript pasted into a document stays inside it.
pub fn hex_lines(bytes: &[u8], per_line: usize) -> Vec<String> {
    assert!(per_line > 0, "a hex line holds at least one byte");
    bytes.chunks(per_line).map(hex).collect()
}

/// One `0x0085` progress frame's content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    /// Page the frame reports on.
    pub page: u8,
    /// `1` = written, `4` = failed, `3` = page outside the Tag's memory.
    pub state: u8,
    /// The page's four bytes, as this frame carried them.
    pub bytes: [u8; PAGE_LEN],
}

/// The page a `0x0085` progress frame carries, when it carries one.
///
/// The payload is page number, state, then the page's four bytes; a frame with
/// any other length is not a progress frame and gets no page.
pub fn progress(frame: &RawFrame) -> Option<Progress> {
    let payload = frame.payload();
    if frame.cmd != CMD_NTAG_PAGE || payload.len() != 6 {
        return None;
    }
    Some(Progress {
        page: payload[0],
        state: payload[1],
        bytes: [payload[2], payload[3], payload[4], payload[5]],
    })
}

/// One page of a `0x0082` request's carried image, as the request marked it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageEntry {
    pub page: usize,
    /// The state byte the request set for this page: `2` is write.
    pub state: u8,
    /// The four bytes at `0x30 + 4 * page`.
    pub bytes: [u8; PAGE_LEN],
}

/// A `0x0082` payload laid out by field.
///
/// The payload alone does not name its pages: the carried image is page 0
/// onwards, so page `n` is at `0x30 + 4n` and its state is the `n`th byte of the
/// table at `0x430`. A transcript uses this to show *which* pages a request
/// marked for writing, rather than leaving that to be inferred from 1328 bytes
/// of hex.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteStructure {
    /// The 8-byte read token the request echoes, hex.
    pub token_hex: String,
    /// Payload `8..12`, little endian.
    pub selector: u32,
    /// Payload `12..16`, little endian: the flag (status) dword.
    pub flag: u32,
    /// First page of the carried image — page 4. Pages 0..3 are the UID, the
    /// static lock bytes and the Capability Container, and a write never marks
    /// them.
    pub first_data_page: usize,
    /// Every page the request marked `2`, in page order, with its bytes.
    pub written: Vec<PageEntry>,
    /// The whole 256-byte page-state table, payload `0x430..0x530`.
    pub states: Vec<u8>,
}

impl WriteStructure {
    /// The state byte the request set for one page.
    pub fn state_at(&self, page: usize) -> Option<u8> {
        self.states.get(page).copied()
    }

    /// The pages marked `2`.
    pub fn marked(&self) -> Vec<usize> {
        self.written.iter().map(|entry| entry.page).collect()
    }

    /// Pages 0..3, which a write must never mark. `None` when the payload is
    /// shorter than the state table.
    pub fn identity_pages_unmarked(&self) -> bool {
        (0..USER_FIRST_PAGE).all(|page| self.state_at(page) == Some(0))
    }
}

/// Lay a `0x0082` payload out by field, or say why it cannot be.
///
/// Reads the payload, never the device: the caller passes the payload of the
/// frame it recorded (or, if it has no tap, of the frame the writer built), and
/// this is what labels it.
pub fn describe_write_payload(payload: &[u8]) -> Result<WriteStructure, String> {
    if payload.len() < WRITE_PAYLOAD_LEN {
        return Err(format!(
            "a 0x0082 payload is {WRITE_PAYLOAD_LEN} bytes (0x{WRITE_PAYLOAD_LEN:X}); this one is {}",
            payload.len()
        ));
    }
    let selector = u32::from_le_bytes([payload[8], payload[9], payload[10], payload[11]]);
    let flag = u32::from_le_bytes([payload[12], payload[13], payload[14], payload[15]]);
    let states = payload[0x430..0x430 + PAGE_COUNT].to_vec();
    let mut written = Vec::new();
    for (page, &state) in states.iter().enumerate() {
        if state != STATE_WRITE {
            continue;
        }
        let at = 0x30 + page * PAGE_LEN;
        written.push(PageEntry {
            page,
            state,
            bytes: [
                payload[at],
                payload[at + 1],
                payload[at + 2],
                payload[at + 3],
            ],
        });
    }
    Ok(WriteStructure {
        token_hex: hex(&payload[0..8]),
        selector,
        flag,
        first_data_page: USER_FIRST_PAGE,
        written,
        states,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ntag;
    use crate::stream::{encode_frame, split_reports};

    /// The `0x0085` progress frame recorded in docs/PROTOCOL.md for an erase:
    /// page 4 = `03 00 FE 00`, state 1.
    const RECORDED_PROGRESS: &str = "55 00 85 00 06 04 01 03 00 FE 00 07 F8";

    fn recorded(bytes: &str) -> Vec<u8> {
        crate::reader::parse_hex(bytes).expect("a recorded frame is hex")
    }

    fn cut_all(bytes: &[u8]) -> (Vec<RawFrame>, usize) {
        let mut cutter = FrameCutter::new();
        let frames = cutter.push(bytes);
        (frames, cutter.leftover().len())
    }

    #[test]
    fn a_frame_takes_one_report_per_started_64_bytes() {
        assert_eq!(report_count(0), 0);
        assert_eq!(report_count(1), 1);
        assert_eq!(report_count(64), 1);
        assert_eq!(report_count(65), 2);
        assert_eq!(report_count(1335), 21, "the 0x0082 write frame");
        assert_eq!(report_count(1344), 21, "21 reports of 64 bytes");
        assert_eq!(report_count(1345), 22);
        assert_eq!(report_count(1029), 17, "a 0x0085 frame is 13 bytes");
    }

    #[test]
    fn a_recorded_progress_frame_is_labelled_as_the_docs_show_it() {
        let (frames, leftover) = cut_all(&recorded(RECORDED_PROGRESS));
        assert_eq!(leftover, 0);
        assert_eq!(frames.len(), 1);
        let frame = &frames[0];
        assert_eq!(frame.cmd, CMD_NTAG_PAGE);
        assert_eq!(frame.declared_len, 6);
        assert_eq!(frame.total(), 13);
        assert_eq!(frame.reports(), 1);
        assert_eq!(frame.checksum, (0x07, 0xF8));
        assert!(frame.checksum_ok, "the recorded frame verifies");
        assert_eq!(
            frame_line(Direction::In, frame),
            "IN  0x0085  len=0x0006  cksum=07 F8 ok   total=13 bytes  1 report"
        );
        assert_eq!(
            progress(frame),
            Some(Progress {
                page: 4,
                state: 1,
                bytes: [0x03, 0x00, 0xFE, 0x00],
            })
        );
    }

    #[test]
    fn a_checksum_that_does_not_verify_is_reported_not_hidden() {
        let mut bytes = recorded(RECORDED_PROGRESS);
        let last = bytes.len() - 1;
        bytes[last] ^= 0xFF;
        let (frames, _) = cut_all(&bytes);
        assert_eq!(frames.len(), 1, "the frame is still handed on");
        assert!(!frames[0].checksum_ok);
        assert_eq!(frames[0].checksum, (0x07, 0xF8 ^ 0xFF));
    }

    #[test]
    fn a_1335_byte_frame_is_cut_out_of_reports_one_at_a_time() {
        let payload: Vec<u8> = (0..0x530).map(|at| (at % 251) as u8).collect();
        let frame = encode_frame(ntag::CMD_NTAG_WRITE, &payload);
        assert_eq!(frame.len(), 1335);
        let reports = split_reports(&frame);
        assert_eq!(reports.len(), 21, "21 reports carry 1335 bytes");

        let mut cutter = FrameCutter::new();
        let mut frames = Vec::new();
        for report in &reports {
            frames.extend(cutter.push(report));
        }
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].bytes, frame, "byte for byte, as sent");
        assert_eq!(frames[0].declared_len, 0x530);
        assert!(frames[0].checksum_ok);
        assert_eq!(cutter.leftover().len(), 0, "the padding was dropped");
    }

    #[test]
    fn reports_of_two_back_to_back_frames_stay_two_frames() {
        let first = encode_frame(CMD_NTAG_PAGE, &[0x04, 0x01, 0x03, 0x00, 0xFE, 0x00]);
        let second = encode_frame(CMD_NTAG_PAGE, &[0x05, 0x01, 0, 0, 0, 0]);
        let mut stream = Vec::new();
        for frame in [&first, &second] {
            for report in split_reports(frame) {
                stream.extend_from_slice(&report);
            }
        }
        let (frames, leftover) = cut_all(&stream);
        assert_eq!(leftover, 0);
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].bytes, first);
        assert_eq!(frames[1].bytes, second);
    }

    #[test]
    fn a_frame_that_never_finished_is_left_over_rather_than_shortened() {
        let frame = encode_frame(ntag::CMD_NTAG_WRITE, &[0u8; 300]);
        let cut = &frame[..200];
        let (frames, leftover) = cut_all(cut);
        assert!(frames.is_empty(), "a truncated frame is not a frame");
        assert_eq!(leftover, 200, "every byte is held back");
    }

    #[test]
    fn a_declared_length_no_command_uses_is_skipped_as_noise() {
        let mut bytes = vec![MAGIC, 0x00, 0x81, 0xFF, 0xFF];
        bytes.extend_from_slice(&recorded(RECORDED_PROGRESS));
        let (frames, leftover) = cut_all(&bytes);
        assert_eq!(leftover, 0);
        assert_eq!(frames.len(), 1, "the real frame after the noise is found");
        assert_eq!(frames[0].cmd, CMD_NTAG_PAGE);
    }

    #[test]
    fn a_recording_replays_in_wire_order_with_reports_assembled() {
        let request = encode_frame(ntag::CMD_NTAG_WRITE, &[0u8; 0x530]);
        let reply = encode_frame(ntag::CMD_NTAG_WRITE, &[0, 0, 0, 0]);
        let progress_frame = encode_frame(CMD_NTAG_PAGE, &[0x04, 0x01, 0x03, 0x00, 0xFE, 0x00]);
        let mut wire = vec![Wire::Out(request.clone())];
        for report in split_reports(&progress_frame) {
            wire.push(Wire::In(report.to_vec()));
        }
        for report in split_reports(&reply) {
            wire.push(Wire::In(report.to_vec()));
        }

        let logged = replay(&wire);
        assert_eq!(logged.len(), 3);
        let Logged::Frame { direction, frame } = &logged[0] else {
            panic!("the request is a frame");
        };
        assert_eq!(*direction, Direction::Out);
        assert_eq!(frame.bytes, request);
        assert_eq!(frame.reports(), 21);
        let Logged::Frame { direction, frame } = &logged[1] else {
            panic!("the progress frame is a frame");
        };
        assert_eq!(*direction, Direction::In);
        assert_eq!(frame.cmd, CMD_NTAG_PAGE);
        assert_eq!(progress(frame).map(|p| p.page), Some(4));
        let Logged::Frame { direction, frame } = &logged[2] else {
            panic!("the write reply is a frame");
        };
        assert_eq!(*direction, Direction::In);
        assert_eq!(frame.cmd, ntag::CMD_NTAG_WRITE);
        assert_eq!(frame.payload(), [0, 0, 0, 0]);
    }

    #[test]
    fn a_reset_never_splices_a_partial_frame_onto_the_next_reply() {
        // A truncated reply, then a whole one: replay must report the bytes the
        // transport threw away instead of gluing them to the next frame.
        let truncated = &encode_frame(ntag::CMD_NTAG_WRITE, &[0u8; 300])[..40];
        let whole = encode_frame(CMD_NTAG_PAGE, &[0x04, 0x01, 0x03, 0x00, 0xFE, 0x00]);
        let wire = vec![
            Wire::In(truncated.to_vec()),
            Wire::Break,
            Wire::In(whole.clone()),
        ];
        let logged = replay(&wire);
        assert_eq!(logged.len(), 2);
        assert_eq!(logged[0], Logged::Reset { discarded: 40 });
        let Logged::Frame { frame, .. } = &logged[1] else {
            panic!("the whole frame is a frame");
        };
        assert_eq!(frame.bytes, whole, "not widened by the discarded bytes");
    }

    #[test]
    fn the_structure_of_a_write_payload_names_the_pages_it_marks() {
        // The writer's own builder, so the labels are checked against the bytes
        // the shipping path would send rather than against a hand-made buffer.
        let mut image = vec![0u8; PAGE_COUNT * PAGE_LEN];
        image[12..16].copy_from_slice(&[0xE1, 0x10, 0x3E, 0x00]);
        let token = [0xFFu8; 8];
        let writes: Vec<(usize, [u8; PAGE_LEN])> = (0..13)
            .map(|index| {
                let page = 4 + index;
                (page, [page as u8, 0xD1, 0x01, 0x54])
            })
            .collect();
        let payload = ntag::write_payload(&token, 1, &image, &writes, 124)
            .expect("pages 4..17 are user pages");

        let structure = describe_write_payload(&payload).expect("a 0x0082 payload");
        assert_eq!(structure.token_hex, hex(&token));
        assert_eq!(structure.selector, 1);
        assert_eq!(structure.flag, 1, "the accepted flag dword is 01 00 00 00");
        assert_eq!(structure.first_data_page, 4);
        assert_eq!(structure.marked(), (4..17).collect::<Vec<usize>>());
        assert_eq!(structure.written.len(), 13);
        assert_eq!(structure.states.len(), PAGE_COUNT);
        assert!(structure.identity_pages_unmarked(), "pages 0..3 stay alone");
        assert_eq!(structure.state_at(4), Some(STATE_WRITE));
        assert_eq!(structure.state_at(16), Some(STATE_WRITE));
        assert_eq!(structure.state_at(17), Some(0));
        let first = structure.written[0];
        assert_eq!(first.page, 4);
        assert_eq!(first.bytes, [4, 0xD1, 0x01, 0x54]);
        assert_eq!(
            first.bytes,
            [
                payload[0x30 + 16],
                payload[0x31 + 16],
                payload[0x32 + 16],
                payload[0x33 + 16],
            ],
            "page 4 sits at 0x30 + 4 * 4"
        );
    }

    #[test]
    fn a_write_payload_too_short_to_hold_its_state_table_is_refused() {
        let payload = vec![0u8; WRITE_PAYLOAD_LEN - 1];
        let error = describe_write_payload(&payload).expect_err("short payload");
        assert!(error.contains("1328"), "{error}");
    }

    #[test]
    fn hex_lines_wrap_without_losing_a_byte() {
        let bytes: Vec<u8> = (0..33).collect();
        let lines = hex_lines(&bytes, 16);
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].split(' ').count(), 16);
        assert_eq!(lines[1].split(' ').count(), 16);
        assert_eq!(lines[2].split(' ').count(), 1);
        assert_eq!(lines[0], hex(&bytes[..16]));
        assert_eq!(lines[2], hex(&bytes[32..]));
    }
}

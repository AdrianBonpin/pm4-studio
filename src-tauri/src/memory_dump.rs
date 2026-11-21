//! S2 — a 13.56 MHz tag's memory as a page dump: offsets, hex and ASCII.
//!
//! This is the diagnostic floor. It exists for the tag the decoder does not
//! recognise, so it deliberately interprets nothing: no capability container, no
//! NDEF, no configuration block. Bytes, their offset, and the state the Reader
//! reported for them are the whole output. The only thing named is which tag the
//! dump came from — its UID and the moment it was read — so two exports can be
//! told apart.
//!
//! Everything here is pure: a 1284-byte `0x0081` payload in, a dump out. The
//! reassembly of that payload from 21 USB reports is `stream::ReportStream`'s
//! job, and the `0x0081` exchange is `ntag`'s. That split is the seam the tests
//! below exercise: recorded bytes, no hardware.
//!
//! Layout of the payload, from docs/PROTOCOL.md ("`0x0081` — NTAG read —
//! VERIFIED"): a status dword, 256 pages of 4 bytes, then 256 per-page state
//! bytes.

use serde::{Deserialize, Serialize};

/// The `0x0081` reply payload: status(4) + 256 x 4 page bytes + 256 states.
pub const NTAG_READ_PAYLOAD_LEN: usize = 1284;

/// Pages the payload can hold, whatever the tag actually has.
pub const PAGE_COUNT: usize = 256;

/// Bytes in one NTAG page.
pub const PAGE_LEN: usize = 4;

/// Where the page table starts, after the status dword.
pub const PAGE_DATA_START: usize = 4;

/// Where the per-page state table starts.
pub const PAGE_STATES_START: usize = 0x404;

/// Bytes on one dump row, so a row is four pages and its ASCII view reads.
pub const BYTES_PER_ROW: usize = 16;

/// Pages on one dump row.
pub const PAGES_PER_ROW: usize = BYTES_PER_ROW / PAGE_LEN;

/// Page state: the read succeeded.
pub const STATE_READ_OK: u8 = 1;

/// Page state: the page is outside the tag's memory.
pub const STATE_OUTSIDE_MEMORY: u8 = 3;

/// Status dword of a completed read.
pub const STATUS_COMPLETED: u32 = 0;

/// Why a payload is not a dump.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DumpError {
    /// The payload is not the length a `0x0081` reply is.
    WrongLength { got: usize },
    /// The read did not complete.
    Status { status: u32 },
}

impl DumpError {
    /// What to tell the user. Each message says the dump was not produced.
    pub fn message(&self) -> String {
        match self {
            DumpError::WrongLength { got } => format!(
                "the memory read returned {got} bytes instead of the \
                 {NTAG_READ_PAYLOAD_LEN} a page dump needs, so there is no dump"
            ),
            DumpError::Status { status } => match status {
                1 => {
                    "no 13.56 MHz tag is on the Reader, so there was no memory to read".to_string()
                }
                other => format!(
                    "the Reader reported status {other} instead of a completed read, \
                     so there is no dump"
                ),
            },
        }
    }
}

impl std::fmt::Display for DumpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message())
    }
}

impl std::error::Error for DumpError {}

/// Which tag a dump came from.
///
/// The UID and the timestamp are what tell two exports apart. The label is a
/// convenience and is derived from the tag type the info reply reported.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagIdentity {
    /// The tag's UID, as hex bytes: `04 43 8A 01 22 09 03`.
    pub uid: String,
    /// The tag type from the `0x0083` info reply.
    pub tag_type: u32,
    /// The tag type in words, or `tag type N` when it is not a known one.
    pub tag_label: String,
    /// When the memory was read, ISO 8601, from the caller's clock.
    pub captured_at: String,
}

impl TagIdentity {
    pub fn new(uid: impl Into<String>, tag_type: u32, captured_at: impl Into<String>) -> Self {
        Self {
            uid: uid.into(),
            tag_type,
            tag_label: tag_label(tag_type),
            captured_at: captured_at.into(),
        }
    }
}

/// The tag type in words, for the tag types the protocol names.
///
/// `5` is the only value docs/PROTOCOL.md assigns, and it assigns it to an
/// NTAG215. Any other value is reported by number rather than guessed at.
pub fn tag_label(tag_type: u32) -> String {
    match tag_type {
        5 => "NTAG215".to_string(),
        other => format!("tag type {other}"),
    }
}

/// The states of one row in words.
fn state_label(page_states: &[u8]) -> String {
    let first = page_states[0];
    if page_states.iter().all(|&state| state == first) {
        if first == STATE_READ_OK {
            "ok".to_string()
        } else {
            format!("state {first}")
        }
    } else {
        let states: Vec<String> = page_states.iter().map(|state| state.to_string()).collect();
        format!("states {}", states.join(" "))
    }
}

/// Bytes as the two-digit hex the dump shows, space separated.
fn hex_bytes(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// One character per byte, `.` for anything that is not printable ASCII.
///
/// The dot is deliberately the same for `00` and for `E1`: the ASCII column is
/// there to make readable text easy to spot, not to suggest a code page.
fn ascii_of(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|&b| {
            if (0x20..=0x7E).contains(&b) {
                b as char
            } else {
                '.'
            }
        })
        .collect()
}

/// `2026-11-21T09:30:00.000Z` as `20261121-093000`, for a file name.
fn compact_time(captured_at: &str) -> String {
    let text = captured_at.as_bytes();
    let shaped = captured_at.is_ascii()
        && text.len() >= 19
        && text[4] == b'-'
        && text[7] == b'-'
        && text[10] == b'T'
        && text[13] == b':'
        && text[16] == b':';
    if !shaped {
        return "unknown-time".to_string();
    }
    let date = format!(
        "{}{}{}",
        &captured_at[0..4],
        &captured_at[5..7],
        &captured_at[8..10]
    );
    let time = format!(
        "{}{}{}",
        &captured_at[11..13],
        &captured_at[14..16],
        &captured_at[17..19]
    );
    format!("{date}-{time}")
}

/// One row of the dump: four pages, and the ASCII view of their 16 bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpRow {
    /// First page on this row.
    pub first_page: u16,
    /// Last page on this row.
    pub last_page: u16,
    /// Byte offset of the first byte, counted from the start of tag memory.
    pub offset: u32,
    /// The 16 bytes as hex, space separated.
    pub hex: String,
    /// The same 16 bytes as ASCII, one character per byte, `.` for unprintable.
    pub ascii: String,
    /// The Reader's state for each page on the row, one entry per page.
    pub page_states: Vec<u8>,
    /// The states in words: `ok`, `state 3`, or `states 1 1 3 3`.
    pub state_label: String,
    /// True only when every byte on the row was reported read-ok.
    pub readable: bool,
}

/// One tag's memory, as the Reader returned it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDump {
    /// The reply's status dword; a dump only exists for `0`.
    pub status: u32,
    /// The tag the dump came from.
    pub tag: TagIdentity,
    /// Pages the payload carries, readable or not.
    pub page_count: usize,
    /// Pages whose state says the read succeeded.
    pub readable_pages: usize,
    /// The page table, four pages to a row.
    pub rows: Vec<DumpRow>,
}

impl MemoryDump {
    /// Parse one `0x0081` payload into a dump.
    ///
    /// A payload of the wrong length, or one whose status dword is not a
    /// completed read, is an error: a dump that is silently short or taken from
    /// a failed read would look like a real tag's memory.
    pub fn parse(payload: &[u8], tag: TagIdentity) -> Result<Self, DumpError> {
        if payload.len() != NTAG_READ_PAYLOAD_LEN {
            return Err(DumpError::WrongLength { got: payload.len() });
        }
        let status = u32::from_le_bytes([payload[0], payload[1], payload[2], payload[3]]);
        if status != STATUS_COMPLETED {
            return Err(DumpError::Status { status });
        }

        let mut rows = Vec::with_capacity(PAGE_COUNT / PAGES_PER_ROW);
        let mut readable_pages = 0;
        for first in (0..PAGE_COUNT).step_by(PAGES_PER_ROW) {
            let mut hex = String::new();
            let mut ascii = String::new();
            let mut page_states = Vec::with_capacity(PAGES_PER_ROW);
            for offset_in_row in 0..PAGES_PER_ROW {
                let page = first + offset_in_row;
                let at = PAGE_DATA_START + page * PAGE_LEN;
                let bytes = &payload[at..at + PAGE_LEN];
                if offset_in_row > 0 {
                    hex.push(' ');
                }
                hex.push_str(&hex_bytes(bytes));
                ascii.push_str(&ascii_of(bytes));
                page_states.push(payload[PAGE_STATES_START + page]);
            }
            // A page counts as readable on the Reader's own state byte, never
            // on whether its bytes look like something.
            readable_pages += page_states
                .iter()
                .filter(|&&state| state == STATE_READ_OK)
                .count();

            rows.push(DumpRow {
                first_page: first as u16,
                last_page: (first + PAGES_PER_ROW - 1) as u16,
                offset: (first * PAGE_LEN) as u32,
                hex,
                ascii,
                state_label: state_label(&page_states),
                readable: page_states.iter().all(|&state| state == STATE_READ_OK),
                page_states,
            });
        }

        Ok(Self {
            status,
            tag,
            page_count: PAGE_COUNT,
            readable_pages,
            rows,
        })
    }

    /// The dump as the text file an export writes.
    ///
    /// One line per four pages: the page range, the byte offset, the hex, the
    /// ASCII and the Reader's state. Nothing is interpreted, so the file is
    /// evidence rather than a decode.
    pub fn to_text(&self) -> String {
        let mut text = String::new();
        text.push_str("PM4 Studio — memory dump\n");
        text.push_str(&format!("Tag: {}\n", self.tag.tag_label));
        text.push_str(&format!("UID: {}\n", self.tag.uid));
        text.push_str(&format!("Read at: {}\n", self.tag.captured_at));
        text.push_str(&format!("Status: {} (read completed)\n", self.status));
        text.push_str(&format!(
            "Pages: {} x {} bytes, {} readable\n",
            self.page_count, PAGE_LEN, self.readable_pages
        ));
        text.push_str("Page states: 1 = read ok, 3 = outside the tag's memory\n");
        text.push('\n');
        text.push_str(&format!(
            "{:<9} {:<7} {:<47}  {:<16}  state\n",
            "page", "offset", "hex", "ascii"
        ));
        for row in &self.rows {
            text.push_str(&format!(
                "{:<9} {:<7} {:<47}  {:<16}  {}\n",
                format!("{:03}-{:03}", row.first_page, row.last_page),
                format!("0x{:04X}", row.offset),
                row.hex,
                row.ascii,
                row.state_label,
            ));
        }
        text
    }

    /// The name a new export is offered with: the UID and the read time, so
    /// two dumps of two tags never overwrite each other by accident.
    pub fn suggested_file_name(&self) -> String {
        let uid: String = self
            .tag
            .uid
            .chars()
            .filter(|c| c.is_ascii_hexdigit())
            .collect::<String>()
            .to_ascii_uppercase();
        let uid = if uid.is_empty() {
            "unknown-uid".to_string()
        } else {
            uid
        };
        format!(
            "pm4-dump-{}-{}.txt",
            uid,
            compact_time(&self.tag.captured_at)
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader::parse_hex;
    use crate::stream::{encode_frame, ReportStream};

    const CAPTURED_AT: &str = "2026-11-21T09:30:00.000Z";
    const NTAG215_UID: &str = "04 43 8A 01 22 09 03";

    /// The real NTAG215 read recorded in docs/PROTOCOL.md, page by page.
    ///
    /// Only the pages the protocol records are filled in; every other page stays
    /// zero, so a row that does not contain one of these values is checking the
    /// formatter rather than an invented tag.
    fn recorded_payload() -> Vec<u8> {
        let mut payload = vec![0u8; NTAG_READ_PAYLOAD_LEN];

        let mut write_page = |index: usize, bytes: [u8; PAGE_LEN]| {
            let at = PAGE_DATA_START + index * PAGE_LEN;
            payload[at..at + PAGE_LEN].copy_from_slice(&bytes);
        };

        // Page 0: UID0..UID2 + BCC0. Page 1: UID3..UID6. Page 2: BCC1 + 3 bytes.
        write_page(0, [0x04, 0x43, 0x8A, 0x45]);
        write_page(1, [0x01, 0x22, 0x09, 0x03]);
        write_page(2, [0x29, 0x48, 0x00, 0x00]);
        // Page 3: the NFC Forum Type 2 Capability Container (`E1 10 3E 00`).
        write_page(3, [0xE1, 0x10, 0x3E, 0x00]);
        // Pages 4..8: the recorded NDEF TLV for https://devgo.studio.
        let ndef = parse_hex("03 11 D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F FE")
            .expect("recorded NDEF bytes");
        for (i, chunk) in ndef.chunks(PAGE_LEN).enumerate() {
            write_page(4 + i, chunk.try_into().expect("four bytes"));
        }
        // Pages 130..134: the config-shaped block both tested tags returned.
        write_page(130, [0x00, 0x00, 0x00, 0xBD]);
        write_page(131, [0x04, 0x00, 0x00, 0xFF]);
        write_page(132, [0x00, 0x05, 0x00, 0x00]);
        write_page(133, [0x00, 0x00, 0x00, 0x00]);
        write_page(134, [0x00, 0x00, 0x00, 0x00]);

        // An NTAG215 has 135 pages (0..=134); the rest are outside its memory.
        for page in 0..=134 {
            payload[PAGE_STATES_START + page] = STATE_READ_OK;
        }
        for page in 135..PAGE_COUNT {
            payload[PAGE_STATES_START + page] = STATE_OUTSIDE_MEMORY;
        }
        payload
    }

    fn recorded_tag() -> TagIdentity {
        TagIdentity::new(NTAG215_UID, 5, CAPTURED_AT)
    }

    fn recorded_dump() -> MemoryDump {
        MemoryDump::parse(&recorded_payload(), recorded_tag()).expect("the recorded read parses")
    }

    /// The bytes on one page, read back out of the rendered hex.
    fn page_bytes(dump: &MemoryDump, page: usize) -> [u8; PAGE_LEN] {
        let row = &dump.rows[page / PAGES_PER_ROW];
        let bytes = parse_hex(&row.hex).expect("a row's hex is hex");
        let at = (page % PAGES_PER_ROW) * PAGE_LEN;
        bytes[at..at + PAGE_LEN].try_into().expect("four bytes")
    }

    #[test]
    fn a_recorded_ntag215_dump_parses_into_rows_of_four_pages() {
        let dump = recorded_dump();

        assert_eq!(dump.status, STATUS_COMPLETED);
        assert_eq!(dump.page_count, PAGE_COUNT);
        assert_eq!(
            dump.rows.len(),
            PAGE_COUNT / PAGES_PER_ROW,
            "64 rows of 4 pages"
        );
        assert_eq!(
            dump.readable_pages, 135,
            "an NTAG215 answers for pages 0..=134"
        );

        let first = &dump.rows[0];
        assert_eq!((first.first_page, first.last_page), (0, 3));
        assert_eq!(first.offset, 0x0000);
        assert_eq!(
            first.hex, "04 43 8A 45 01 22 09 03 29 48 00 00 E1 10 3E 00",
            "recorded pages 0..3, unchanged by the renderer"
        );
        assert_eq!(first.ascii, ".C.E.\"..)H....>.");
        assert_eq!(first.state_label, "ok");
        assert!(first.readable);
    }

    #[test]
    fn the_dump_agrees_with_the_uid_and_bcc_bytes_from_the_independent_poll() {
        // The poll UID is the independent value; the tag's own anticollision
        // bytes must agree with it (ISO14443-A). A dump that passes this is a
        // dump of the tag the Reader reports, not just a plausible buffer.
        let dump = recorded_dump();
        let uid = parse_hex(NTAG215_UID).expect("the poll UID");

        assert_eq!(page_bytes(&dump, 0)[0..3], uid[0..3], "UID0..UID2");
        assert_eq!(
            page_bytes(&dump, 0)[3],
            0x88 ^ uid[0] ^ uid[1] ^ uid[2],
            "BCC0"
        );
        assert_eq!(page_bytes(&dump, 1), uid[3..7], "UID3..UID6");
        assert_eq!(
            page_bytes(&dump, 2)[0],
            uid[3] ^ uid[4] ^ uid[5] ^ uid[6],
            "BCC1"
        );
    }

    #[test]
    fn the_capability_container_page_is_the_published_constant() {
        // A published NFC Forum value, not something the firmware invents.
        assert_eq!(page_bytes(&recorded_dump(), 3), [0xE1, 0x10, 0x3E, 0x00]);
    }

    #[test]
    fn the_uri_in_the_user_area_is_visible_in_the_ascii_view() {
        let dump = recorded_dump();
        let ascii: String = dump.rows.iter().map(|row| row.ascii.as_str()).collect();
        assert!(
            ascii.contains("devgo.studio"),
            "the ASCII view spells the recorded URI: {ascii}"
        );
    }

    #[test]
    fn a_page_outside_the_tags_memory_is_marked_not_hidden() {
        let dump = recorded_dump();
        let last = dump.rows.last().expect("a last row");
        assert_eq!((last.first_page, last.last_page), (252, 255));
        assert_eq!(last.state_label, "state 3");
        assert_eq!(last.page_states, vec![STATE_OUTSIDE_MEMORY; 4]);
        assert!(!last.readable, "an unread row is not counted readable");
        assert_eq!(last.hex.len(), BYTES_PER_ROW * 3 - 1);
    }

    #[test]
    fn the_text_names_the_tag_and_when_it_was_read() {
        let text = recorded_dump().to_text();

        assert!(text.starts_with("PM4 Studio — memory dump\n"), "{text}");
        assert!(text.contains("Tag: NTAG215\n"));
        assert!(
            text.contains("UID: 04 43 8A 01 22 09 03\n"),
            "UID identifies the tag"
        );
        assert!(
            text.contains("Read at: 2026-11-21T09:30:00.000Z\n"),
            "the read time tells two exports apart"
        );
        assert!(text.contains("Status: 0 (read completed)"));
        assert!(text.contains("Pages: 256 x 4 bytes, 135 readable"));
        assert!(text.contains("Page states: 1 = read ok, 3 = outside the tag's memory"));
        assert!(text.ends_with('\n'), "a text file ends with a newline");
    }

    #[test]
    fn every_row_has_the_same_offset_hex_and_ascii_columns() {
        let text = recorded_dump().to_text();
        let rows: Vec<&str> = text
            .lines()
            .filter(|line| line.len() > 9 && line.as_bytes()[3] == b'-')
            .collect();
        assert_eq!(rows.len(), 64, "one line per row");

        // page(9) space offset(7) space hex(47) two spaces ascii(16).
        const ASCII_AT: usize = 9 + 1 + 7 + 1 + 47 + 2;
        assert_eq!(
            &rows[0][..ASCII_AT],
            "000-003   0x0000  04 43 8A 45 01 22 09 03 29 48 00 00 E1 10 3E 00  "
        );
        assert_eq!(&rows[0][ASCII_AT..ASCII_AT + 16], ".C.E.\"..)H....>.");
        assert_eq!(
            &rows[1][..ASCII_AT],
            "004-007   0x0010  03 11 D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75  "
        );
        assert_eq!(&rows[1][ASCII_AT..ASCII_AT + 16], ".....U.devgo.stu");
        assert_eq!(
            &rows[32][..ASCII_AT],
            "128-131   0x0200  00 00 00 00 00 00 00 00 00 00 00 BD 04 00 00 FF  "
        );
        assert!(rows[0][ASCII_AT + 16..].starts_with("  ok"));
        assert!(rows[63][ASCII_AT + 16..].starts_with("  state 3"));

        for line in &rows {
            assert!(
                line.len() > ASCII_AT + 16,
                "every row carries its columns and a state: {line}"
            );
        }
    }

    #[test]
    fn a_read_that_did_not_complete_is_an_error_not_a_dump() {
        let mut payload = recorded_payload();
        payload[0] = 1; // status dword 1: nothing to operate on.

        let refused =
            MemoryDump::parse(&payload, recorded_tag()).expect_err("status 1 has no dump");
        assert_eq!(refused, DumpError::Status { status: 1 });
        assert!(
            refused.message().contains("no 13.56 MHz tag"),
            "{}",
            refused.message()
        );

        payload[0] = 32;
        let refused = MemoryDump::parse(&payload, recorded_tag()).expect_err("status 32");
        assert_eq!(refused, DumpError::Status { status: 32 });
        assert!(
            refused.message().contains("status 32"),
            "{}",
            refused.message()
        );
    }

    #[test]
    fn a_payload_that_is_not_a_page_dump_is_refused_by_length() {
        for len in [0usize, 4, 1283, 1285, 2048] {
            let payload = vec![0u8; len];
            assert_eq!(
                MemoryDump::parse(&payload, recorded_tag()),
                Err(DumpError::WrongLength { got: len }),
                "a {len}-byte payload is not a dump"
            );
        }
    }

    #[test]
    fn a_tag_type_the_protocol_has_not_named_is_reported_by_number() {
        assert_eq!(tag_label(5), "NTAG215");
        let unknown = TagIdentity::new(NTAG215_UID, 7, CAPTURED_AT);
        assert_eq!(unknown.tag_label, "tag type 7");
    }

    #[test]
    fn the_read_reply_reassembled_from_21_reports_parses_to_the_same_dump() {
        // The seam: reassembly and the dump formatter, with the recorded bytes
        // and no hardware. The frame is the verified 1291-byte shape.
        let payload = recorded_payload();
        let frame = encode_frame(0x0081, &payload);
        assert_eq!(frame.len(), 1291, "verified read reply frame length");

        let reports = crate::stream::split_reports(&frame);
        assert_eq!(reports.len(), 21, "verified: 21 USB reports");

        let mut stream = ReportStream::new();
        let mut reassembled = None;
        for report in &reports {
            stream.push(report);
            if let Some(frame) = stream.next_frame() {
                reassembled = Some(frame);
            }
        }
        let frame = reassembled.expect("21 reports are one frame");
        assert_eq!(frame.cmd, 0x0081);
        assert!(
            frame.payload.len() > 64,
            "a reported frame longer than one report is not truncated"
        );
        assert!(frame.checksum_ok);
        assert_eq!(stream.take_error(), None, "no truncation was reported");

        let dump = MemoryDump::parse(&frame.payload, recorded_tag()).expect("the reassembled dump");
        assert_eq!(dump, recorded_dump(), "the same bytes, the same dump");
    }

    #[test]
    fn the_suggested_file_name_carries_the_uid_and_the_time() {
        assert_eq!(
            recorded_dump().suggested_file_name(),
            "pm4-dump-04438A01220903-20261121-093000.txt"
        );
    }

    #[test]
    fn an_unreadable_time_still_produces_a_usable_file_name() {
        let dump = MemoryDump::parse(
            &recorded_payload(),
            TagIdentity::new(NTAG215_UID, 5, "not a timestamp"),
        )
        .expect("the dump");
        assert_eq!(
            dump.suggested_file_name(),
            "pm4-dump-04438A01220903-unknown-time.txt"
        );
    }
}

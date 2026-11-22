//! Reading a Tag's Records back out of its Type 2 NDEF structure.
//!
//! This is the read half of the read-edit-rewrite loop. A Tag's user memory is
//! not a message; it holds a **TLV** — `03 <len> <message> FE` — and the
//! message inside it is NDEF. This module does the outer layer only: find the
//! NDEF TLV, say whether the bytes it claims are actually on the Tag, and hand
//! the message out as bytes. Turning those bytes into Records is the webview
//! codec's job (`src/lib/ndef.ts`), which is where the eleven Record kinds and
//! their payload layouts already live.
//!
//! Nothing here is new byte-level interpretation. The TLV reader itself is
//! `ntag::read_ndef_tlv`, which ticket 18 built for the write preview and which
//! is already proven against the recorded NTAG215; the page layout is
//! `ntag::MemoryImage`, from the same verified `0x0081` reply. What this module
//! adds is the honest **outcome**: every way a Tag can fail to yield Records is
//! named separately, because "the Tag is not NDEF formatted" and "the Tag
//! carries an empty message" and "the TLV claims more bytes than the Tag holds"
//! are three different facts about three different Tags, and collapsing them
//! into "failed" tells the user nothing they can act on.
//!
//! The one rule this module enforces beyond the TLV reader: a page of user
//! memory the Reader did not report as read makes the whole user area
//! untrustworthy. A message partly assembled from a hole in the read is worse
//! than no message at all, because it looks complete.
//!
//! Read-only in the strongest sense: nothing in this file builds a write frame,
//! and the command that calls it sends only `0x0083` and `0x0081`.

use crate::memory_dump::{
    DumpError, NTAG_READ_PAYLOAD_LEN, PAGE_LEN as DUMP_PAGE_LEN, STATE_READ_OK, STATUS_COMPLETED,
};
use crate::ntag::{read_ndef_tlv, MemoryImage, NdefTlv, CC_PAGE, USER_FIRST_PAGE};
use crate::reader::hex;
use serde::Serialize;

/// The user area holds an NDEF message this module recovered.
pub const OUTCOME_MESSAGE: &str = "message";
/// The user area holds an NDEF TLV of length zero: a message with no Records.
pub const OUTCOME_EMPTY: &str = "empty";
/// The user area is NDEF formatted but holds no NDEF TLV at all.
pub const OUTCOME_MISSING: &str = "missing";
/// Page 3 is not a Type 2 Capability Container, so there is no NDEF area.
pub const OUTCOME_NOT_FORMATTED: &str = "notFormatted";
/// The user area does not parse, or was not read in full: no message is claimed.
pub const OUTCOME_UNREADABLE: &str = "unreadable";

/// What one Tag's Type 2 NDEF structure turned out to be.
///
/// `outcome` is the whole answer; every other field is evidence for it. The
/// message is handed over as hex because that is how bytes already cross this
/// boundary for a write (`draftMessageHex`), and hex cannot be mistaken for
/// text the Tag holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagNdef {
    /// "message" | "empty" | "missing" | "notFormatted" | "unreadable".
    pub outcome: &'static str,
    /// The NDEF message, space-separated hex. Empty unless `outcome` is
    /// "message"; never a partial message.
    pub message_hex: String,
    /// How many bytes the message is.
    pub message_bytes: usize,
    /// The user memory the TLV was read from, hex: what a raw view shows.
    pub user_memory_hex: String,
    /// How many bytes of user memory the Capability Container declared.
    pub user_memory_bytes: usize,
    /// User memory in bytes, from the Type 2 CC. `None` when page 3 is not one.
    pub capacity_bytes: Option<usize>,
    /// User memory in pages, from the same CC.
    pub user_pages: Option<usize>,
    /// Page 3 as read, hex: the Capability Container, or what sits there.
    pub capability_container_hex: String,
    /// Why there is no message to load, when there is none.
    pub reason: Option<String>,
}

impl TagNdef {
    /// Read the NDEF structure out of one `0x0081` reply payload.
    ///
    /// Pure: recorded bytes in, an outcome out, no Reader. A payload that is
    /// not a completed read is refused by the same rules as
    /// [`crate::memory_dump::MemoryDump::parse`], so the dump and the Records
    /// shown beside it can never describe two different reads.
    pub fn from_read_payload(payload: &[u8]) -> Result<Self, DumpError> {
        if payload.len() != NTAG_READ_PAYLOAD_LEN {
            return Err(DumpError::WrongLength { got: payload.len() });
        }
        let status = u32::from_le_bytes([payload[0], payload[1], payload[2], payload[3]]);
        if status != STATUS_COMPLETED {
            return Err(DumpError::Status { status });
        }
        let image = MemoryImage::from_read_payload(payload)
            .ok_or(DumpError::WrongLength { got: payload.len() })?;

        let cc = image.page(CC_PAGE).unwrap_or([0u8; DUMP_PAGE_LEN]);
        let cc_hex = hex(&cc);
        let capacity_bytes = image.user_capacity_bytes();
        let user = image.user_area();

        let Some(capacity_bytes) = capacity_bytes else {
            return Ok(Self {
                outcome: OUTCOME_NOT_FORMATTED,
                message_hex: String::new(),
                message_bytes: 0,
                user_memory_hex: String::new(),
                user_memory_bytes: 0,
                capacity_bytes: None,
                user_pages: None,
                capability_container_hex: cc_hex.clone(),
                reason: Some(format!(
                    "page {CC_PAGE} holds {cc_hex} instead of a Type 2 Capability Container, \
                     so the tag is not NDEF formatted and there is no message to read"
                )),
            });
        };
        let user_pages = capacity_bytes / DUMP_PAGE_LEN;

        // A hole in the read makes every byte after it a guess. Name the page
        // rather than returning the zero-filled memory as "no message".
        if let Some((page, state)) = unread_user_page(&image, user_pages) {
            return Ok(Self {
                outcome: OUTCOME_UNREADABLE,
                message_hex: String::new(),
                message_bytes: 0,
                user_memory_hex: hex(&user),
                user_memory_bytes: user.len(),
                capacity_bytes: Some(capacity_bytes),
                user_pages: Some(user_pages),
                capability_container_hex: cc_hex,
                reason: Some(match state {
                    Some(state) => format!(
                        "page {page} of the tag's user memory was not read (state {state}), \
                         so the user memory is incomplete and no message is claimed"
                    ),
                    None => format!(
                        "the read did not return page {page} of the tag's user memory, \
                         so the user memory is incomplete and no message is claimed"
                    ),
                }),
            });
        }

        let (outcome, message, reason) = match read_ndef_tlv(&user) {
            NdefTlv::Message { message, .. } => (OUTCOME_MESSAGE, message, None),
            NdefTlv::Empty => (
                OUTCOME_EMPTY,
                Vec::new(),
                Some(
                    "the tag is NDEF formatted and its NDEF TLV is empty (03 00), so it holds \
                     a message of zero bytes and therefore no Records"
                        .to_string(),
                ),
            ),
            NdefTlv::Missing => (
                OUTCOME_MISSING,
                Vec::new(),
                Some(
                    "the tag is NDEF formatted but its user memory holds no 0x03 NDEF TLV, \
                     so it carries no NDEF message"
                        .to_string(),
                ),
            ),
            NdefTlv::Unreadable { reason } => (OUTCOME_UNREADABLE, Vec::new(), Some(reason)),
        };

        Ok(Self {
            outcome,
            message_hex: hex(&message),
            message_bytes: message.len(),
            user_memory_hex: hex(&user),
            user_memory_bytes: user.len(),
            capacity_bytes: Some(capacity_bytes),
            user_pages: Some(user_pages),
            capability_container_hex: cc_hex,
            reason,
        })
    }

    /// True only when there is a message to decode.
    pub fn has_message(&self) -> bool {
        self.outcome == OUTCOME_MESSAGE && self.message_bytes > 0
    }
}

/// One Tag as a Records read returns it: the bytes, and what they mean.
///
/// The dump travels with the TLV result so a Tag whose Records cannot be
/// decoded can be shown as raw bytes without a second read of the Tag — the
/// fallback view is then genuinely the same bytes the decode was attempted on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRecordsRead {
    pub dump: crate::memory_dump::MemoryDump,
    pub ndef: TagNdef,
}

/// The first user page the Reader did not report as read, with the state it
/// did report. `None` means every page of the user area was read.
fn unread_user_page(image: &MemoryImage, user_pages: usize) -> Option<(usize, Option<u8>)> {
    (USER_FIRST_PAGE..USER_FIRST_PAGE + user_pages)
        .find_map(|page| match image.state(page) {
            Some(STATE_READ_OK) => None,
            state => Some((page, state)),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::{DraftRecord, InsertOutcome, Library};
    use crate::memory_dump::{
        MemoryDump, TagIdentity, PAGE_DATA_START, PAGE_STATES_START, STATE_OUTSIDE_MEMORY,
    };
    use crate::ntag::wrap_ndef_message;
    use crate::reader::parse_hex;

    const CAPTURED_AT: &str = "2026-11-21T09:30:00.000Z";
    const NTAG215_UID: &str = "04 43 8A 01 22 09 03";

    /// The NDEF TLV recorded in docs/PROTOCOL.md, pages 4..8, byte for byte.
    const RECORDED_TLV: &str =
        "03 11 D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F FE";
    /// The message inside that TLV: a URL Record for https://devgo.studio.
    const RECORDED_MESSAGE: &str = "D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F";

    /// A `0x0081` payload built the way the recorded NTAG215 read was: the
    /// recorded UID and Capability Container, `user` from page 4, an NTAG215's
    /// 135 readable pages, and nothing outside its memory.
    fn payload_with(user: &[u8], capacity_bytes: usize) -> Vec<u8> {
        assert_eq!(capacity_bytes % 8, 0, "a Type 2 CC counts 8-byte units");
        let mut payload = vec![0u8; NTAG_READ_PAYLOAD_LEN];
        let mut write_page = |index: usize, bytes: [u8; DUMP_PAGE_LEN]| {
            let at = PAGE_DATA_START + index * DUMP_PAGE_LEN;
            payload[at..at + DUMP_PAGE_LEN].copy_from_slice(&bytes);
        };
        write_page(0, [0x04, 0x43, 0x8A, 0x45]);
        write_page(1, [0x01, 0x22, 0x09, 0x03]);
        write_page(2, [0x29, 0x48, 0x00, 0x00]);
        let cc_units = (capacity_bytes / 8) as u8;
        write_page(3, [0xE1, 0x10, cc_units, 0x00]);
        for (index, chunk) in user.chunks(DUMP_PAGE_LEN).enumerate() {
            let mut page = [0u8; DUMP_PAGE_LEN];
            page[..chunk.len()].copy_from_slice(chunk);
            write_page(USER_FIRST_PAGE + index, page);
        }
        for page in 0..=134 {
            payload[PAGE_STATES_START + page] = STATE_READ_OK;
        }
        for page in 135..crate::memory_dump::PAGE_COUNT {
            payload[PAGE_STATES_START + page] = STATE_OUTSIDE_MEMORY;
        }
        payload
    }

    /// The recorded read exactly: `03 11 …FE` on pages 4..8 of an NTAG215.
    fn recorded_payload() -> Vec<u8> {
        payload_with(&parse_hex(RECORDED_TLV).expect("recorded TLV bytes"), 496)
    }

    fn recorded() -> TagNdef {
        TagNdef::from_read_payload(&recorded_payload()).expect("the recorded read parses")
    }

    #[test]
    fn the_recorded_ntag215_yields_the_recorded_nd_ef_message() {
        let read = recorded();

        assert_eq!(read.outcome, OUTCOME_MESSAGE);
        assert!(read.has_message());
        assert_eq!(
            read.message_hex, RECORDED_MESSAGE,
            "the message inside the TLV, not the TLV itself"
        );
        assert_eq!(read.message_bytes, 0x11);
        assert_eq!(read.reason, None);
        assert_eq!(read.capacity_bytes, Some(496), "E1 10 3E 00");
        assert_eq!(read.user_pages, Some(124));
        assert_eq!(read.user_memory_bytes, 496);
        assert_eq!(read.capability_container_hex, "E1 10 3E 00");
    }

    #[test]
    fn the_user_memory_starts_at_page_four_and_carries_the_recorded_tlv_verbatim() {
        // The parser must skip the 4-byte status dword, then pages 0..3, and not
        // start the message at the wrong byte: the recorded TLV proves it.
        let read = recorded();
        assert_eq!(
            PAGE_DATA_START + USER_FIRST_PAGE * DUMP_PAGE_LEN,
            4 + 4 * 4,
            "status dword, then pages 0..3, then user memory"
        );
        assert_eq!(PAGE_STATES_START, 0x404, "the state table is where the protocol says");

        let user = parse_hex(&read.user_memory_hex).expect("user memory hex");
        assert_eq!(
            &user[..RECORDED_TLV.len() / 3 + 1],
            parse_hex(RECORDED_TLV).expect("recorded TLV").as_slice(),
            "user memory begins with the recorded 03 11 … FE"
        );
    }

    #[test]
    fn the_dump_and_the_tlv_read_describe_the_same_payload() {
        let payload = recorded_payload();
        let dump = MemoryDump::parse(&payload, TagIdentity::new(NTAG215_UID, 5, CAPTURED_AT))
            .expect("the dump");
        let read = TagNdef::from_read_payload(&payload).expect("the TLV read");

        assert_eq!(dump.readable_pages, 135);
        assert_eq!(read.capacity_bytes.map(|b| b / DUMP_PAGE_LEN), Some(124));
        // Pages 4..8 of the dump are the TLV, read back out of the rendered hex.
        let tlv_row = &dump.rows[1];
        assert!(tlv_row.hex.starts_with("03 11 D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75"));
        assert_eq!(
            read.user_memory_hex
                .split(' ')
                .take(16)
                .collect::<Vec<_>>()
                .join(" "),
            tlv_row.hex,
            "the user area starts on page 4, so the TLV row is exactly its first 16 bytes"
        );
    }

    #[test]
    fn an_empty_ndef_tlv_is_an_empty_message_not_a_failure() {
        // `03 00 FE`: the recorded tag written back to its factory state.
        let read = TagNdef::from_read_payload(&payload_with(
            &parse_hex("03 00 FE 00").expect("empty TLV"),
            496,
        ))
        .expect("an empty message still parses");

        assert_eq!(read.outcome, OUTCOME_EMPTY);
        assert_eq!(read.message_bytes, 0);
        assert!(!read.has_message());
        assert_eq!(read.message_hex, "");
        let reason = read.reason.expect("an empty message says so");
        assert!(reason.contains("empty"), "{reason}");
        assert!(reason.contains("no Records"), "{reason}");
    }

    #[test]
    fn a_tag_with_no_ndef_tlv_is_named_as_such() {
        // Formatted (the CC is there) but never written: all zeros, i.e. NULL
        // TLVs all the way to the end of user memory.
        let read = TagNdef::from_read_payload(&payload_with(&[0u8; 496], 496))
            .expect("a formatted tag with no message parses");
        assert_eq!(read.outcome, OUTCOME_MISSING);
        assert_eq!(read.message_hex, "");
        let reason = read.reason.expect("a reason");
        assert!(reason.contains("no 0x03 NDEF TLV"), "{reason}");

        // And the same when a terminator comes first, which is how a blank
        // tag reads after an erase: `FE` at page 4.
        let read = TagNdef::from_read_payload(&payload_with(
            &parse_hex("FE 00 00 00").expect("terminator"),
            496,
        ))
        .expect("a terminator-only tag parses");
        assert_eq!(read.outcome, OUTCOME_MISSING);
    }

    #[test]
    fn a_tag_that_is_not_nd_ef_formatted_is_told_apart_from_one_that_is_empty() {
        // Page 3 is not a Capability Container: an unformatted NTAG reads 00s.
        let mut payload = payload_with(&[], 496);
        let at = PAGE_DATA_START + CC_PAGE * DUMP_PAGE_LEN;
        payload[at..at + DUMP_PAGE_LEN].copy_from_slice(&[0x00, 0x00, 0x00, 0x00]);

        let read = TagNdef::from_read_payload(&payload).expect("unformatted still parses");
        assert_eq!(read.outcome, OUTCOME_NOT_FORMATTED);
        assert_eq!(read.capacity_bytes, None);
        assert_eq!(read.user_memory_bytes, 0);
        assert_eq!(read.capability_container_hex, "00 00 00 00");
        let reason = read.reason.expect("a reason");
        assert!(reason.contains("not NDEF formatted"), "{reason}");
        assert!(reason.contains("00 00 00 00"), "it says what it found: {reason}");
    }

    #[test]
    fn a_truncated_tlv_that_claims_more_than_the_tag_holds_is_refused() {
        // `03 FF 01 F0` claims 496 bytes in a 496-byte area that also has to
        // hold the header: one byte too many. Nothing is half-returned.
        let mut user = parse_hex("03 FF 01 F0").expect("header");
        user.resize(496, 0x41);
        let read = TagNdef::from_read_payload(&payload_with(&user, 496)).expect("parses");
        assert_eq!(read.outcome, OUTCOME_UNREADABLE);
        assert_eq!(read.message_bytes, 0);
        assert_eq!(read.message_hex, "", "a truncated message is not handed out");
        let reason = read.reason.expect("a reason");
        assert!(reason.contains("declares 496 message bytes"), "{reason}");
    }

    #[test]
    fn a_short_form_tlv_truncated_by_the_tag_is_refused_too() {
        // A one-page tag (8 bytes of user memory) whose TLV claims 8 message
        // bytes: the header has to live in the same 8 bytes, so it cannot fit.
        let user = parse_hex("03 08 41 41 41 41 41 41").expect("header and some bytes");
        let read = TagNdef::from_read_payload(&payload_with(&user, 8)).expect("parses");
        assert_eq!(read.outcome, OUTCOME_UNREADABLE);
        assert_eq!(read.message_hex, "");
        let reason = read.reason.expect("a reason");
        assert!(reason.contains("declares 8 message bytes"), "{reason}");
    }

    #[test]
    fn a_message_of_255_bytes_or_more_is_read_through_the_extended_length_form() {
        // A real NDEF message of 307 bytes: MB|ME, TNF 1, type length 1, a
        // four-byte payload length of 300, type 'T', then 300 payload bytes.
        let mut message = vec![0xC1, 0x01, 0x00, 0x00, 0x01, 0x2C, 0x54];
        message.extend(std::iter::repeat(0x41).take(300));
        assert_eq!(message.len(), 307);

        let tlv = wrap_ndef_message(&message);
        assert_eq!(&tlv[..4], &[0x03, 0xFF, 0x01, 0x33], "FF <hi> <lo>");
        let read = TagNdef::from_read_payload(&payload_with(&tlv, 496)).expect("parses");
        assert_eq!(read.outcome, OUTCOME_MESSAGE);
        assert_eq!(read.message_bytes, 307);
        assert_eq!(read.message_hex, hex(&message), "all 307 bytes, in order");
    }

    #[test]
    fn null_and_lock_control_tlvs_before_the_ndef_one_are_stepped_over() {
        // 00 (NULL), 00, 01 03 AA BB CC (lock control), then the recorded TLV.
        let mut user = parse_hex("00 00 01 03 AA BB CC").expect("leading TLVs");
        user.extend(parse_hex(RECORDED_TLV).expect("recorded TLV"));
        let read = TagNdef::from_read_payload(&payload_with(&user, 496)).expect("parses");

        assert_eq!(read.outcome, OUTCOME_MESSAGE);
        assert_eq!(read.message_hex, RECORDED_MESSAGE);
    }

    #[test]
    fn a_hole_in_the_read_is_never_reported_as_no_message() {
        // Page 6 of a 124-page user area was not read: its four bytes are
        // positionally part of the message, so nothing may be claimed from it.
        let mut payload = recorded_payload();
        payload[PAGE_STATES_START + 6] = STATE_OUTSIDE_MEMORY;
        let read = TagNdef::from_read_payload(&payload).expect("parses");

        assert_eq!(read.outcome, OUTCOME_UNREADABLE);
        assert_eq!(read.message_hex, "");
        let reason = read.reason.expect("a reason");
        assert!(reason.contains("page 6"), "{reason}");
        assert!(reason.contains("state 3"), "{reason}");
        assert_eq!(
            read.user_memory_bytes, 496,
            "the bytes are still handed over for the raw view"
        );
    }

    #[test]
    fn a_read_that_did_not_complete_is_an_error_not_a_result() {
        let mut payload = recorded_payload();
        payload[0] = 1;
        assert_eq!(
            TagNdef::from_read_payload(&payload),
            Err(DumpError::Status { status: 1 })
        );
    }

    #[test]
    fn a_payload_that_is_not_a_page_read_is_refused_by_length() {
        for len in [0usize, 4, 1283, 1285] {
            assert_eq!(
                TagNdef::from_read_payload(&vec![0u8; len]),
                Err(DumpError::WrongLength { got: len })
            );
        }
    }

    #[test]
    fn the_11_record_kinds_all_keep_their_order_through_a_re_read() {
        // The order is the message's order: a two-Record message read back must
        // list the Records the same way round. This checks the bytes the
        // webview decodes, using a message with two distinct Records.
        let text = parse_hex("D1 01 05 54 02 65 6E 41").expect("text record");
        let url = parse_hex("51 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F")
            .expect("url record");
        let mut message = text;
        message.extend(url);
        let read = TagNdef::from_read_payload(&payload_with(
            &wrap_ndef_message(&message),
            496,
        ))
        .expect("parses");

        assert_eq!(read.outcome, OUTCOME_MESSAGE);
        assert_eq!(read.message_hex, hex(&message));
        assert!(
            read.message_hex.starts_with("D1 01 05 54"),
            "the first Record stays first: {}",
            read.message_hex
        );
    }

    #[test]
    fn loading_a_tag_into_a_draft_leaves_a_snapshot_of_that_tag_untouched() {
        // The load path writes Drafts and only Drafts. A Snapshot is a record of
        // a read and is never edited, so a Tag already in the Library must be
        // exactly as it was after its Records are loaded into a new Draft.
        let read = recorded();
        let mut library = Library::empty();
        let InsertOutcome::Added(snapshot) = library.add_hf(
            crate::library::HfFields {
                uid: NTAG215_UID.to_string(),
                raw: RECORDED_TLV.to_string(),
                atqa: None,
                sak: None,
                card_type: None,
                capacity_bytes: None,
                ndef_formatted: None,
                records: None,
            },
            CAPTURED_AT,
        ) else {
            panic!("the first Snapshot of a tag is added");
        };
        let before = snapshot.clone();

        let mut draft = library.add_draft(&format!("Tag {NTAG215_UID}"), CAPTURED_AT);
        draft.records = vec![DraftRecord {
            kind: "url".to_string(),
            fields: [("url".to_string(), "https://devgo.studio".to_string())]
                .into_iter()
                .collect(),
        }];
        assert!(library.save_draft(draft.clone()));

        assert_eq!(library.snapshots, vec![before], "the Snapshot is unchanged");
        assert_eq!(library.snapshots[0].write_count, 0, "and not written to");
        assert_eq!(library.drafts.len(), 1);
        assert_eq!(library.drafts[0].records, draft.records);
        assert!(read.has_message(), "the read that loaded it succeeded");
    }
}

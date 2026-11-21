//! 13.56 MHz NTAG: info, memory read, and one whole NDEF message written.
//!
//! The protocol facts this module relies on are recorded in docs/PROTOCOL.md
//! under "NTAG command family — VERIFIED (spike 16)". Everything below that
//! decides *what bytes to send* is a pure function, so the frame shapes are
//! testable against the spike's recorded bytes with no hardware attached. The
//! device session at the bottom is the only part that needs a Reader.
//!
//! Why the write is built this way:
//!
//!   * `0x0082` does not write one page; it takes the Tag's whole 256-page
//!     image plus a per-page state table, and only pages marked `2` are
//!     changed. Carrying the whole image is what stops an unmentioned page
//!     changing — the spike wrote one page that way and the Tag finished
//!     byte-identical apart from that page.
//!   * The checksum covers only `len & 0xFF` payload bytes, i.e. the 48-byte
//!     header and not one byte of page data. `stream::encode_frame` does that;
//!     nothing here recomputes it.
//!   * The write-path tag selector accepts `0..=4` and refuses `5`, which is
//!     what `0x0083` reports for an NTAG215. `DEFAULT_TAG_SELECTOR` is the
//!     value the spike proved, not the reported tag type.
//!
//! An NDEF message on a Type 2 Tag is a TLV: `03 <len> <message> FE`. The codec
//! that produces the message lives in the webview (`src/lib/ndef.ts`); this
//! module owns the TLV wrapper, because the TLV is a property of the Tag's
//! memory layout rather than of NDEF.

use crate::memory_dump::TagIdentity;
use crate::reader::{hex, Reader};
use crate::stream::encode_frame;
use crate::write_outcome::{classify_evidence, JudgedEvidence, WriteOutcome};

// ---- command ids and layout -------------------------------------------

/// NTAG info: 6-byte request, 64-byte body, `LEN 0x40`.
pub const CMD_NTAG_INFO: u16 = 0x0083;
/// NTAG memory read: 16-byte request, 1284-byte reply over 21 reports.
pub const CMD_NTAG_READ: u16 = 0x0081;
/// NTAG write: 1328-byte request over 21 reports.
pub const CMD_NTAG_WRITE: u16 = 0x0082;
/// Per-page streaming reply emitted while a read or write runs.
pub const CMD_NTAG_PAGE: u16 = 0x0085;

/// Bytes per NTAG page.
pub const PAGE_LEN: usize = 4;
/// Pages in the image a `0x0082` request carries.
pub const PAGE_COUNT: usize = 256;
/// First page of user memory. Pages 0..3 hold UID, BCC, static lock bytes and
/// the Type 2 Capability Container, and must never be written.
pub const USER_FIRST_PAGE: usize = 4;
/// Page holding the Type 2 Capability Container.
pub const CC_PAGE: usize = 3;

/// Size of the `0x0082` payload: token, selector, flag, 256 pages, 256 states.
pub const WRITE_PAYLOAD_LEN: usize = 0x530;
/// Exact request length `0x0083` wants.
pub const INFO_PAYLOAD_LEN: usize = 6;
/// Exact request length `0x0081` wants.
pub const READ_PAYLOAD_LEN: usize = 16;

/// The write-path tag selector value the spike proved on hardware. `0x0083`
/// reports `5` for the same NTAG215 and `0x0082` refuses that with status 32,
/// so the reported tag type must never be copied into this field.
pub const DEFAULT_TAG_SELECTOR: u32 = 3;
/// Highest selector `0x0082` accepts. Above this it answers status 32.
pub const MAX_TAG_SELECTOR: u32 = 4;

/// Type 2 TLV tag for an NDEF message.
pub const NDEF_TLV: u8 = 0x03;
/// Type 2 TLV terminator.
pub const TERMINATOR_TLV: u8 = 0xFE;
/// Length byte meaning "a two-byte length follows".
pub const LONG_LENGTH_MARKER: u8 = 0xFF;

/// `0x0083` status: NTAG ready and info complete.
pub const STATUS_READY: u32 = 4;
/// `0x0083` status: nothing latched.
pub const STATUS_NO_TAG: u32 = 1;
/// `0x0083`/`0x0082` status: request refused for a bad parameter.
pub const STATUS_REFUSED: u32 = 32;

/// Page-state byte meaning "write this page".
pub const STATE_WRITE: u8 = 2;

// ---- what the Tag currently holds -------------------------------------

/// One NDEF TLV as read from a Tag's user memory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NdefTlv {
    /// No NDEF TLV at all: memory that was never NDEF formatted.
    Missing,
    /// An NDEF TLV carrying an empty message (`03 00 FE`).
    Empty,
    /// A message, plus the bytes the whole TLV and its terminator occupy.
    Message { message: Vec<u8>, tlv_len: usize },
    /// Bytes that do not parse as a Type 2 TLV. Never guessed at: a truncated
    /// message must not look like a complete one.
    Unreadable { reason: String },
}

/// Wrap an NDEF message in its Type 2 TLV: `03 <len> <message> FE`.
///
/// The one-byte length form carries up to 254 bytes; 255 and above use the
/// three-byte form `FF <hi> <lo>`, per the Type 2 Tag specification.
pub fn wrap_ndef_message(message: &[u8]) -> Vec<u8> {
    assert!(
        message.len() <= u16::MAX as usize,
        "an NDEF message that long cannot be length-prefixed by a Type 2 TLV"
    );
    let mut out = Vec::with_capacity(message.len() + 5);
    out.push(NDEF_TLV);
    if message.len() < LONG_LENGTH_MARKER as usize {
        out.push(message.len() as u8);
    } else {
        out.push(LONG_LENGTH_MARKER);
        out.extend_from_slice(&(message.len() as u16).to_be_bytes());
    }
    out.extend_from_slice(message);
    out.push(TERMINATOR_TLV);
    out
}

/// The NDEF TLV a Tag's user memory holds. `user_area` is page 4 onwards.
pub fn read_ndef_tlv(user_area: &[u8]) -> NdefTlv {
    let mut at = 0usize;
    loop {
        let Some(&tag) = user_area.get(at) else {
            return NdefTlv::Missing;
        };
        match tag {
            // A NULL TLV occupies one byte and carries nothing.
            0x00 => at += 1,
            TERMINATOR_TLV => return NdefTlv::Missing,
            NDEF_TLV => {
                let (len, len_bytes) = match read_tlv_length(user_area, at + 1) {
                    Ok(v) => v,
                    Err(reason) => return NdefTlv::Unreadable { reason },
                };
                let start = at + 1 + len_bytes;
                let end = start + len;
                if end > user_area.len() {
                    return NdefTlv::Unreadable {
                        reason: format!(
                            "the NDEF TLV declares {len} message bytes and only {} remain",
                            user_area.len().saturating_sub(start)
                        ),
                    };
                }
                let message = user_area[start..end].to_vec();
                if message.is_empty() {
                    return NdefTlv::Empty;
                }
                // The terminator belongs to the TLV: Type 2 Tags write one, and
                // it is what tells a reader the message ends here.
                let tlv_len = end - at + usize::from(user_area.get(end) == Some(&TERMINATOR_TLV));
                return NdefTlv::Message { message, tlv_len };
            }
            // 0xFF is not a TLV tag: memory that reads this is not formatted, or
            // the read did not return real data.
            LONG_LENGTH_MARKER => {
                return NdefTlv::Unreadable {
                    reason: "user memory holds 0xFF where a TLV should start".to_string(),
                }
            }
            // Any other TLV (lock control, memory control, proprietary) is
            // skipped by its own length so the NDEF TLV behind it is still found.
            _ => {
                let (len, len_bytes) = match read_tlv_length(user_area, at + 1) {
                    Ok(v) => v,
                    Err(reason) => return NdefTlv::Unreadable { reason },
                };
                let end = at + 1 + len_bytes + len;
                if end > user_area.len() {
                    return NdefTlv::Unreadable {
                        reason: format!(
                            "a TLV with tag 0x{tag:02X} declares {len} bytes and runs past                              the end of user memory"
                        ),
                    };
                }
                at = end;
            }
        }
    }
}

/// The length of a TLV: one byte below 0xFF, otherwise `FF <hi> <lo>`.
fn read_tlv_length(bytes: &[u8], at: usize) -> Result<(usize, usize), String> {
    let Some(&first) = bytes.get(at) else {
        return Err("a TLV has no length byte".to_string());
    };
    if first < LONG_LENGTH_MARKER {
        Ok((first as usize, 1))
    } else if at + 3 > bytes.len() {
        Err("a TLV's three-byte length runs past the end of user memory".to_string())
    } else {
        Ok((u16::from_be_bytes([bytes[at + 1], bytes[at + 2]]) as usize, 3))
    }
}

/// User memory in bytes from a Type 2 Capability Container page (`E1 10 3E 00`
/// = 496 bytes). `None` when the page is not a Type 2 CC, because a capacity
/// that cannot be read must not be invented: capacity decides how many bytes a
/// write sends.
pub fn capacity_from_cc(cc: [u8; PAGE_LEN]) -> Option<usize> {
    // Byte 0 is the magic 0xE1; byte 2 is the user memory size in 8-byte units.
    // Anything else is not a Type 2 Capability Container, so there is no
    // capacity to be had rather than a number to guess at.
    if cc[0] != 0xE1 || cc[2] == 0 {
        return None;
    }
    Some(cc[2] as usize * 8)
}

/// The Tag's memory as `0x0081` returned it: 256 pages of 4 bytes plus the
/// per-page states.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemoryImage {
    pages: Vec<[u8; PAGE_LEN]>,
    states: Vec<u8>,
}

impl MemoryImage {
    /// Parse a `0x0081` reply payload: status dword, 1024 page bytes, 256 page
    /// states. `None` when the payload is too short to hold the status dword.
    pub fn from_read_payload(payload: &[u8]) -> Option<Self> {
        if payload.len() < 4 {
            return None;
        }
        let body = &payload[4..];
        let page_bytes = body.len().min(PAGE_COUNT * PAGE_LEN);
        let mut pages = Vec::with_capacity(page_bytes / PAGE_LEN);
        for chunk in body[..page_bytes].chunks_exact(PAGE_LEN) {
            pages.push([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        let states_at = PAGE_COUNT * PAGE_LEN;
        let states = if body.len() >= states_at + PAGE_COUNT {
            body[states_at..states_at + PAGE_COUNT].to_vec()
        } else {
            Vec::new()
        };
        Some(MemoryImage { pages, states })
    }

    /// One page's four bytes, or `None` when the reply did not carry it.
    pub fn page(&self, page: usize) -> Option<[u8; PAGE_LEN]> {
        self.pages.get(page).copied()
    }

    /// How many pages the reply actually carried.
    pub fn pages(&self) -> usize {
        self.pages.len()
    }

    /// The state byte the Reader reported for one page, when it reported one.
    pub fn state(&self, page: usize) -> Option<u8> {
        self.states.get(page).copied()
    }

    /// Every page flattened to the 1024 bytes a write request must carry,
    /// zero-padded when the reply was short.
    pub fn image_bytes(&self) -> Vec<u8> {
        let mut out = vec![0u8; PAGE_COUNT * PAGE_LEN];
        for (index, page) in self.pages.iter().take(PAGE_COUNT).enumerate() {
            out[index * PAGE_LEN..index * PAGE_LEN + PAGE_LEN].copy_from_slice(page);
        }
        out
    }

    /// User memory in bytes, from the Type 2 CC on page 3.
    pub fn user_capacity_bytes(&self) -> Option<usize> {
        self.page(CC_PAGE).and_then(capacity_from_cc)
    }

    /// User memory in pages, from the Type 2 CC.
    pub fn user_pages(&self) -> Option<usize> {
        self.user_capacity_bytes().map(|bytes| bytes / PAGE_LEN)
    }

    /// The user area: page 4 onwards, up to the capacity the CC declares.
    pub fn user_area(&self) -> Vec<u8> {
        let pages = self.user_pages().unwrap_or(0);
        let mut out = Vec::with_capacity(pages * PAGE_LEN);
        for page in self.pages.iter().skip(USER_FIRST_PAGE).take(pages) {
            out.extend_from_slice(page);
        }
        out
    }
}

// ---- billing one write request ---------------------------------------

/// Why a write was not built. Every one of these is decided before a write
/// frame exists, so a refusal here transmits nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanError {
    /// The Draft holds no Records, so the message is empty.
    EmptyMessage,
    /// The CC on page 3 did not yield a capacity.
    CapacityUnknown,
    /// The TLV does not fit the Tag's user memory.
    TooLarge { required: usize, capacity: usize },
    /// A page that holds UID, BCC, lock bytes or the CC, or one past the user
    /// area. Writing any of them corrupts the Tag.
    PageNotUser { page: usize, user_pages: usize },
    /// The image the read returned does not cover a page that would be written,
    /// so the request cannot carry that page's current contents.
    ImageIncomplete { page: usize },
    /// `0x0082` refuses selectors above 4 with status 32.
    SelectorOutOfRange { selector: u32 },
}

impl std::fmt::Display for PlanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PlanError::EmptyMessage => write!(
                f,
                "this Draft holds no Records, so there is no message to write"
            ),
            PlanError::CapacityUnknown => write!(
                f,
                "the Tag's capacity could not be read from its Capability Container, \
                 so a write could not be sized without guessing"
            ),
            PlanError::TooLarge {
                required,
                capacity,
            } => write!(
                f,
                "the message needs {required} bytes and the Tag holds {capacity}"
            ),
            PlanError::PageNotUser { page, user_pages } => write!(
                f,
                "page {page} is not user memory (pages 0-3 hold the UID, lock bytes and \
                 Capability Container; user memory is pages 4 to {})",
                USER_FIRST_PAGE + user_pages - 1
            ),
            PlanError::ImageIncomplete { page } => write!(
                f,
                "the read did not return page {page}, so the request cannot carry its \
                 current contents"
            ),
            PlanError::SelectorOutOfRange { selector } => write!(
                f,
                "the write-path tag selector accepts 0 to {MAX_TAG_SELECTOR}; got {selector}"
            ),
        }
    }
}

impl std::error::Error for PlanError {}

/// One ready-to-send write: the 1328-byte payload, the pages it changes, and
/// what those pages must read back as.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WritePlan {
    pub payload: Vec<u8>,
    /// Pages marked `2` in the state table, in order.
    pub write_pages: Vec<usize>,
    /// The bytes pages [`Self::write_pages`] must hold afterwards, flattened.
    pub expected_user: Vec<u8>,
    /// Bytes the TLV occupies, header and terminator included.
    pub required_bytes: usize,
    /// User memory the CC declared.
    pub capacity_bytes: usize,
}

/// Build the `0x0082` payload for an explicit set of page writes.
///
/// This is the spike-level builder, kept separate so the frame the hardware
/// accepted can be reconstructed and compared byte for byte. `image` is the
/// 1024 bytes of page data the request carries; `user_pages` is the guard's
/// limit, taken from the Capability Container.
pub fn write_payload(
    token: &[u8; 8],
    selector: u32,
    image: &[u8],
    writes: &[(usize, [u8; PAGE_LEN])],
    user_pages: usize,
) -> Result<Vec<u8>, PlanError> {
    if selector > MAX_TAG_SELECTOR {
        return Err(PlanError::SelectorOutOfRange { selector });
    }
    for (page, _) in writes {
        guard_write_page(*page, user_pages)?;
        if (page + 1) * PAGE_LEN > image.len() {
            return Err(PlanError::ImageIncomplete { page: *page });
        }
    }

    let mut payload = vec![0u8; WRITE_PAYLOAD_LEN];
    payload[0..8].copy_from_slice(token);
    payload[8..12].copy_from_slice(&selector.to_le_bytes());
    // The flag dword: `01 00 00 00` is what the accepted frame carried.
    payload[12..16].copy_from_slice(&1u32.to_le_bytes());
    // 0x10..0x30 is the unknown 32-byte block. Zero works.
    let carried = image.len().min(PAGE_COUNT * PAGE_LEN);
    payload[0x30..0x30 + carried].copy_from_slice(&image[..carried]);
    for (page, data) in writes {
        let at = 0x30 + page * PAGE_LEN;
        payload[at..at + PAGE_LEN].copy_from_slice(data);
        payload[0x430 + page] = STATE_WRITE;
    }
    Ok(payload)
}

/// The guard that stops an NDEF write reaching the UID, the lock bytes or the
/// Capability Container. Pages 0..3 hold exactly those; user memory runs from
/// page 4 for as many pages as the CC declares and no further.
fn guard_write_page(page: usize, user_pages: usize) -> Result<(), PlanError> {
    if page < USER_FIRST_PAGE || page >= USER_FIRST_PAGE + user_pages {
        return Err(PlanError::PageNotUser { page, user_pages });
    }
    Ok(())
}

/// Turn an NDEF message into one complete `0x0082` request: the TLV, page
/// aligned, with the Tag's whole current image carried so nothing else changes.
pub fn plan_write(
    token: &[u8; 8],
    image: &MemoryImage,
    message: &[u8],
    selector: u32,
) -> Result<WritePlan, PlanError> {
    if message.is_empty() {
        return Err(PlanError::EmptyMessage);
    }
    if selector > MAX_TAG_SELECTOR {
        return Err(PlanError::SelectorOutOfRange { selector });
    }
    let capacity_bytes = image.user_capacity_bytes().ok_or(PlanError::CapacityUnknown)?;
    let user_pages = capacity_bytes / PAGE_LEN;

    let tlv = wrap_ndef_message(message);
    let required_bytes = tlv.len();
    if required_bytes > capacity_bytes {
        return Err(PlanError::TooLarge {
            required: required_bytes,
            capacity: capacity_bytes,
        });
    }

    // The new message, page aligned, then zero-filled out to whatever the old
    // message occupied: a write replaces the message, so an old, longer
    // message's tail must not stay readable behind the new terminator.
    let mut region = pad_to_page(tlv);
    let previous_end = match read_ndef_tlv(&image.user_area()) {
        NdefTlv::Message { tlv_len, .. } => tlv_len,
        NdefTlv::Empty => 1 + 1 + 1,
        _ => 0,
    };
    let previous_region = pad_to_page_len(previous_end);
    if previous_region > region.len() {
        region.resize(previous_region, 0);
    }

    let page_count = region.len() / PAGE_LEN;
    let write_pages: Vec<usize> = (0..page_count).map(|i| USER_FIRST_PAGE + i).collect();
    let writes: Vec<(usize, [u8; PAGE_LEN])> = write_pages
        .iter()
        .enumerate()
        .map(|(index, page)| {
            let at = index * PAGE_LEN;
            (
                *page,
                [
                    region[at],
                    region[at + 1],
                    region[at + 2],
                    region[at + 3],
                ],
            )
        })
        .collect();

    let payload = write_payload(
        token,
        selector,
        &image.image_bytes(),
        &writes,
        user_pages,
    )?;

    Ok(WritePlan {
        payload,
        write_pages,
        expected_user: region,
        required_bytes,
        capacity_bytes,
    })
}

fn pad_to_page_len(len: usize) -> usize {
    len.div_ceil(PAGE_LEN) * PAGE_LEN
}

fn pad_to_page(mut bytes: Vec<u8>) -> Vec<u8> {
    let padded = pad_to_page_len(bytes.len());
    bytes.resize(padded, 0);
    bytes
}


// ---- one read of the Tag -------------------------------------------------

/// What `0x0083` reported about the Tag.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagInfo {
    /// Status dword: 4 = ready, 1 = nothing latched, 32 = refused.
    pub status: u32,
    /// The tag type `0x0083` reports (`5` = NTAG215). Deliberately kept apart
    /// from the write-path selector: `0x0082` refuses this value.
    pub reported_tag_type: u32,
    /// The 7-byte UID at payload 0x2A..0x31, low byte first.
    pub uid: Vec<u8>,
    /// The 8-byte read/write token at payload 0x38..0x40.
    pub token: [u8; 8],
}

impl TagInfo {
    /// Parse a `0x0083` reply payload. `None` when it is too short to hold the
    /// status and token.
    pub fn from_info_payload(payload: &[u8]) -> Option<Self> {
        if payload.len() < 0x40 {
            return None;
        }
        let status = u32::from_le_bytes([payload[0], payload[1], payload[2], payload[3]]);
        let reported_tag_type =
            u32::from_le_bytes([payload[4], payload[5], payload[6], payload[7]]);
        let mut token = [0u8; 8];
        token.copy_from_slice(&payload[0x38..0x40]);
        let uid = payload[0x2A..0x31].to_vec();
        Some(TagInfo {
            status,
            reported_tag_type,
            uid,
            token,
        })
    }

    /// The UID as the rest of the app writes one: space-separated uppercase hex.
    pub fn uid_hex(&self) -> String {
        hex(&self.uid)
    }
}

/// One whole read: the info reply and the memory dump that followed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagRead {
    pub info: TagInfo,
    pub memory: MemoryImage,
}

/// What a Tag holds today, in the shape the UI and the confirmation need.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagView {
    /// UID as space-separated hex.
    pub uid: String,
    /// The tag type `0x0083` reported. Not the write-path selector.
    pub reported_tag_type: u32,
    /// User memory in bytes, from the Type 2 CC. `None` when it is not a CC.
    pub capacity_bytes: Option<usize>,
    /// User memory in pages, from the same CC.
    pub user_pages: Option<usize>,
    pub existing: ExistingNdef,
}

/// The NDEF message a Tag carries now, as far as it could be read.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingNdef {
    /// "empty" | "message" | "unreadable"
    pub state: &'static str,
    /// The NDEF message itself, hex, when one was recovered. Decoding it into
    /// Records is the webview codec's job, not this module's.
    pub message_hex: Option<String>,
    /// How many bytes the message occupies.
    pub bytes: usize,
    /// Why the message could not be read, when it could not.
    pub reason: Option<String>,
}

impl TagView {
    pub fn from_read(read: &TagRead) -> Self {
        let user = read.memory.user_area();
        let existing = match read_ndef_tlv(&user) {
            NdefTlv::Message { message, .. } => ExistingNdef {
                state: "message",
                message_hex: Some(hex(&message)),
                bytes: message.len(),
                reason: None,
            },
            NdefTlv::Empty => ExistingNdef {
                state: "empty",
                message_hex: None,
                bytes: 0,
                reason: None,
            },
            NdefTlv::Missing => ExistingNdef {
                state: "empty",
                message_hex: None,
                bytes: 0,
                reason: Some("user memory carries no NDEF TLV".to_string()),
            },
            NdefTlv::Unreadable { reason } => ExistingNdef {
                state: "unreadable",
                message_hex: None,
                bytes: 0,
                reason: Some(reason),
            },
        };
        TagView {
            uid: read.info.uid_hex(),
            reported_tag_type: read.info.reported_tag_type,
            capacity_bytes: read.memory.user_capacity_bytes(),
            user_pages: read.memory.user_pages(),
            existing,
        }
    }
}

// ---- the device session --------------------------------------------------

/// How long `0x0083` gets. The spike waited 5.5 s and saw a reply every time.
pub const INFO_TIMEOUT_MS: u64 = 5_500;
/// How long the 21-report `0x0081` reply gets.
pub const READ_TIMEOUT_MS: u64 = 8_000;
/// How long the write's progress frames and final reply get.
pub const WRITE_TIMEOUT_MS: u64 = 8_000;
/// Settle time between the read and the write, as the spike used.
pub const WRITE_SETTLE_MS: u64 = 400;
/// Settle time before the read-back, as the spike used.
pub const READBACK_SETTLE_MS: u64 = 400;
/// Inter-report pacing for the 21-report write frame. The spike proved 5 ms
/// works; 64 ms makes the firmware abandon the frame.
pub const REPORT_GAP_MS: u64 = 5;

/// The sentence a refusal says when nothing is latched. Exposed so the command
/// layer and the UI cannot drift apart.
pub const NO_TAG_MESSAGE: &str =
    "no 13.56 MHz Tag is in the field, so there is nothing to write";

/// Read the Tag on the Reader: `0x0083` then `0x0081`.
///
/// `Ok(None)` means nothing was latched, which is a Reader state rather than an
/// error. `Err` means the Reader did not answer, or answered something this
/// module cannot use — either way nothing may be written.
pub fn read_tag(reader: &Reader) -> Result<Option<TagRead>, String> {
    reader.drain();
    reader.wake().ok();

    let info_payload = [0x01u8, 0x01, 0x00, 0x00, 0x00, 0x00];
    let info_frame = request(
        reader,
        CMD_NTAG_INFO,
        &info_payload,
        INFO_TIMEOUT_MS,
        |frame| frame.cmd == CMD_NTAG_INFO && frame.payload.len() >= 0x40 && frame.checksum_ok,
    )?
    .ok_or_else(|| {
        "the reader did not answer an NTAG info request. Unplug it, plug it back in, and          press Reconnect."
            .to_string()
    })?;

    let info = TagInfo::from_info_payload(&info_frame.payload)
        .ok_or_else(|| "the reader's NTAG info reply was too short to use".to_string())?;
    if info.status == STATUS_NO_TAG {
        return Ok(None);
    }
    if info.status != STATUS_READY {
        return Err(format!(
            "the reader reported status {} for the Tag instead of a ready NTAG",
            info.status
        ));
    }

    // 0x0081 wants the token, the announced tag type, then seven zero bytes.
    let mut read_payload = Vec::with_capacity(READ_PAYLOAD_LEN);
    read_payload.extend_from_slice(&info.token);
    read_payload.push(info.reported_tag_type as u8);
    read_payload.extend_from_slice(&[0u8; 7]);
    let read_frame = request(reader, CMD_NTAG_READ, &read_payload, READ_TIMEOUT_MS, |frame| {
        frame.cmd == CMD_NTAG_READ && frame.payload.len() >= 0x404 && frame.checksum_ok
    })?
    .ok_or_else(|| "the reader did not answer a memory read".to_string())?;

    let memory = MemoryImage::from_read_payload(&read_frame.payload)
        .ok_or_else(|| "the reader's memory read was too short to use".to_string())?;
    Ok(Some(TagRead { info, memory }))
}

/// Send one command and hand back the first reply `want` accepts.
///
/// Everything else that arrives in the meantime is skipped, which is what makes
/// the per-page `0x0085` frames harmless: a read emits one per page before its
/// final `0x0081`, and waiting for the final frame is what makes the dump whole
/// rather than the first page of it.
fn request(
    reader: &Reader,
    cmd: u16,
    payload: &[u8],
    timeout_ms: u64,
    want: impl Fn(&crate::reader::Frame) -> bool,
) -> Result<Option<crate::reader::Frame>, String> {
    reader.write_frame_paced(&encode_frame(cmd, payload), std::time::Duration::ZERO)?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Ok(None);
        }
        if let Some(frame) = reader.read_one(remaining.as_millis().min(250) as i32)? {
            if want(&frame) {
                return Ok(Some(frame));
            }
        }
    }
}

/// What the write's own reply reported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteReply {
    /// Status dword from the final `0x0082` frame. 0 = carried out, 32 = refused.
    pub status: u32,
    /// One `(page, state)` per `0x0085` progress frame: 1 = written, 4 = failed.
    pub progress: Vec<(u8, u8)>,
}

impl WriteReply {
    /// Pages the firmware said it wrote.
    pub fn written_pages(&self) -> Vec<usize> {
        self.progress
            .iter()
            .filter(|(_, state)| *state == 1)
            .map(|(page, _)| *page as usize)
            .collect()
    }

    /// Pages the firmware said it could not write.
    pub fn failed_pages(&self) -> Vec<usize> {
        self.progress
            .iter()
            .filter(|(_, state)| *state == 4)
            .map(|(page, _)| *page as usize)
            .collect()
    }
}

/// Collect the write's progress frames and its final `0x0082` reply. `None`
/// means the firmware never finished answering, which is not the same as a
/// failed write: the frame was already sent.
fn collect_write_reply(reader: &Reader, timeout_ms: u64) -> Result<Option<WriteReply>, String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
    let mut progress = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Ok(None);
        }
        let Some(frame) = reader.read_one(remaining.as_millis().min(250) as i32)? else {
            continue;
        };
        if frame.cmd == CMD_NTAG_PAGE && frame.payload.len() == 6 {
            progress.push((frame.payload[0], frame.payload[1]));
        } else if frame.cmd == CMD_NTAG_WRITE && frame.payload.len() >= 4 {
            let status = u32::from_le_bytes([
                frame.payload[0],
                frame.payload[1],
                frame.payload[2],
                frame.payload[3],
            ]);
            return Ok(Some(WriteReply { status, progress }));
        }
    }
}

/// One attempted NDEF write, with everything the UI needs to say what happened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NdefWrite {
    /// What the Tag held before the write, from the read this path is required
    /// to do first. `None` when nothing was read.
    pub before: Option<TagView>,
    pub outcome: WriteOutcome,
    /// Why the write did not land a confirmed copy, when it did not.
    pub message: Option<String>,
    pub capacity_bytes: Option<usize>,
    /// Bytes the message needs on the Tag, TLV overhead included. 0 when no
    /// plan was built.
    pub required_bytes: usize,
    /// Pages the request asked the firmware to write.
    pub wrote_pages: Vec<usize>,
    /// Pages the firmware reported it wrote.
    pub accepted_pages: Vec<usize>,
    /// What the Tag read back as afterwards, when it could be re-read.
    pub readback: Option<TagView>,
}

impl NdefWrite {
    fn refused(message: String) -> Self {
        NdefWrite {
            before: None,
            outcome: WriteOutcome::Refused,
            message: Some(message),
            capacity_bytes: None,
            required_bytes: 0,
            wrote_pages: Vec::new(),
            accepted_pages: Vec::new(),
            readback: None,
        }
    }
}

/// What a write would do, without doing it. Reads the Tag, so the confirmation
/// can name what would be replaced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NdefPreview {
    pub tag: Option<TagView>,
    /// Bytes the message needs, TLV overhead included.
    pub required_bytes: usize,
    pub capacity_bytes: Option<usize>,
    /// True only when a write would proceed, so the UI can never show a
    /// confirmation for a write that would be refused.
    pub fits: bool,
    /// Why the write would not proceed, when it would not.
    pub refusal: Option<String>,
}

/// Read the Tag and answer what writing `message` would do to it.
pub fn preview(reader: &Reader, message: &[u8]) -> NdefPreview {
    let tlv_sized = if message.is_empty() {
        0
    } else {
        wrap_ndef_message(message).len()
    };
    let mut preview = NdefPreview {
        tag: None,
        required_bytes: tlv_sized,
        capacity_bytes: None,
        fits: false,
        refusal: None,
    };
    if message.is_empty() {
        preview.refusal = Some(PlanError::EmptyMessage.to_string());
        return preview;
    }

    let read = match read_tag(reader) {
        Ok(Some(read)) => read,
        Ok(None) => {
            preview.refusal = Some(NO_TAG_MESSAGE.to_string());
            return preview;
        }
        Err(e) => {
            preview.refusal = Some(format!("the Tag could not be read: {e}"));
            return preview;
        }
    };
    preview.capacity_bytes = read.memory.user_capacity_bytes();
    preview.tag = Some(TagView::from_read(&read));

    match plan_write(&read.info.token, &read.memory, message, DEFAULT_TAG_SELECTOR) {
        Ok(plan) => {
            preview.required_bytes = plan.required_bytes;
            preview.fits = true;
        }
        Err(error) => {
            preview.refusal = Some(error.to_string());
        }
    }
    preview
}

/// Write one complete NDEF message to the Tag on the Reader, then read it back.
///
/// The order is fixed and each step is a refusal rather than a risk:
///
/// 1. An empty message stops before the device is touched at all.
/// 2. The Tag is read. If it cannot be read, nothing is written — the same
///    fail-closed shape ADR 0001 established for 125 kHz, for the same reason:
///    a blind write does not know what it is overwriting.
/// 3. The plan refuses a message that does not fit, or a Tag whose capacity
///    cannot be read, before a write frame exists.
/// 4. The frame is sent as 21 reports with the pacing the spike proved.
/// 5. The Tag is read back. Only a read-back that matches what was written is
///    `Verified`; a write that was sent and cannot be read back is `Unverified`,
///    which the UI says as "unknown", never as failure.
pub fn write_message(reader: &Reader, message: &[u8]) -> NdefWrite {
    if message.is_empty() {
        return NdefWrite::refused(PlanError::EmptyMessage.to_string());
    }

    let read = match read_tag(reader) {
        Ok(Some(read)) => read,
        Ok(None) => return NdefWrite::refused(NO_TAG_MESSAGE.to_string()),
        Err(e) => {
            return NdefWrite::refused(format!(
                "the Tag could not be read, so nothing was written: {e}"
            ))
        }
    };

    let mut report = NdefWrite {
        before: Some(TagView::from_read(&read)),
        outcome: WriteOutcome::Refused,
        message: None,
        capacity_bytes: read.memory.user_capacity_bytes(),
        required_bytes: wrap_ndef_message(message).len(),
        wrote_pages: Vec::new(),
        accepted_pages: Vec::new(),
        readback: None,
    };

    let plan = match plan_write(
        &read.info.token,
        &read.memory,
        message,
        DEFAULT_TAG_SELECTOR,
    ) {
        Ok(plan) => plan,
        Err(error) => {
            report.message = Some(error.to_string());
            return report;
        }
    };
    report.required_bytes = plan.required_bytes;
    report.wrote_pages = plan.write_pages.clone();

    // The spike read, paused 400 ms, wrote, paused 400 ms, then read back. The
    // pauses are part of the sequence that worked, so they are kept.
    std::thread::sleep(std::time::Duration::from_millis(WRITE_SETTLE_MS));
    let frame = encode_frame(CMD_NTAG_WRITE, &plan.payload);
    reader.drain();
    if let Err(e) = reader.write_frame_paced(
        &frame,
        std::time::Duration::from_millis(REPORT_GAP_MS),
    ) {
        report.outcome = WriteOutcome::Failed;
        report.message = Some(format!("the write could not be sent: {e}"));
        return report;
    }

    let reply = match collect_write_reply(reader, WRITE_TIMEOUT_MS) {
        Ok(reply) => reply,
        // The frame was sent, so a reader that stops answering leaves the Tag
        // in an unknown state rather than unwritten. The read-back below is the
        // only thing that can settle it.
        Err(_) => None,
    };
    if let Some(reply) = &reply {
        report.accepted_pages = reply.written_pages();
    }

    std::thread::sleep(std::time::Duration::from_millis(READBACK_SETTLE_MS));
    let readback = read_tag(reader);
    let matched = match &readback {
        Ok(Some(after)) => {
            let user = after.memory.user_area();
            user.len() >= plan.expected_user.len()
                && user[..plan.expected_user.len()] == plan.expected_user[..]
        }
        _ => false,
    };
    if let Ok(Some(after)) = &readback {
        report.readback = Some(TagView::from_read(after));
    }

    let declined = reply
        .as_ref()
        .map(|reply| reply.status == STATUS_REFUSED)
        .unwrap_or(false);
    report.outcome = if declined {
        // The firmware said it would not act, and PROTOCOL.md records status 32
        // as nothing written — not a Tag whose contents are unknown.
        classify_evidence(JudgedEvidence::NotTransmitted)
    } else {
        match &readback {
            // Sent, and the Tag could not be read again: unknown.
            Err(_) | Ok(None) => classify_evidence(JudgedEvidence::Readback(None)),
            Ok(Some(_)) => classify_evidence(JudgedEvidence::Readback(Some(matched))),
        }
    };

    report.message = match report.outcome {
        WriteOutcome::Verified => None,
        WriteOutcome::Refused => report
            .message
            .or_else(|| Some("the write was not attempted".to_string())),
        WriteOutcome::Failed if declined => Some(format!(
            "the reader refused the write request (status {STATUS_REFUSED}), which it              answers for a parameter it will not accept. Nothing was written."
        )),
        WriteOutcome::Failed => report
            .message
            .or_else(|| Some("the write could not be sent".to_string())),
        // An NDEF write replaces a message; it never blanks a Tag, so this
        // arm is unreachable. Stated rather than defaulted so a future change
        // to the shared vocabulary fails loudly here instead of silently.
        WriteOutcome::Blanked => Some(
            "the write reported a blanked Tag, which an NDEF write cannot produce".to_string(),
        ),
        WriteOutcome::Unverified => Some(match &readback {
            Err(_) | Ok(None) => "the write was sent but the Tag could not be read back, so                                   what it holds is unknown"
                .to_string(),
            Ok(Some(_)) => "the write was sent but the Tag does not read back as the message                             that was written, so what it holds is unknown"
                .to_string(),
        }),
    };

    report
}


// ---- the memory-dump read path (ticket 19) -------------------------------
//
// `MemoryDump::parse` wants the raw `0x0081` payload and a `TagIdentity` for its
// header, so this path keeps its own parse of the info reply rather than
// converting through `TagInfo`. The command ids and page layout above are
// shared; only the reply-reading entry points differ.

/// The info reply is 64 payload bytes, whatever it says.
pub const INFO_REPLY_LEN: usize = 0x40;

/// The 6-byte info request: count, short flag, and a `u32` page index of zero.
pub const INFO_REQUEST: [u8; 6] = [0x01, 0x01, 0x00, 0x00, 0x00, 0x00];

/// Status dword telling the info reply is usable.
pub const INFO_STATUS_READY: u32 = 4;
/// Status dword telling there is nothing to operate on.
pub const INFO_STATUS_NONE: u32 = 1;

/// Payload offsets in the info reply.
pub const INFO_TAG_TYPE: std::ops::Range<usize> = 4..8;
pub const INFO_UID: std::ops::Range<usize> = 0x2A..0x31;
pub const INFO_READ_TOKEN: std::ops::Range<usize> = 0x38..0x40;


/// How long the Reader is given to answer the info command.
const INFO_TRANSACT_TIMEOUT_MS: i32 = 5_500;
/// How long the Reader is given to finish a memory read. The verified read
/// arrives as 21 reports, so this is generous but finite: a silent Reader
/// fails instead of leaving the page waiting.
const READ_TRANSACT_TIMEOUT_MS: i32 = 8_000;

/// Why an info reply cannot be used to read memory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InfoError {
    /// The reply is shorter than the 64 bytes the read path needs.
    WrongLength { got: usize },
    /// The status dword is not "tag ready".
    Status { status: u32 },
}

impl InfoError {
    pub fn message(&self) -> String {
        match self {
            InfoError::WrongLength { got } => format!(
                "the Reader's tag info reply is {got} bytes, not the \
                 {INFO_REPLY_LEN} the memory read needs"
            ),
            InfoError::Status { status } if *status == INFO_STATUS_NONE => {
                "no 13.56 MHz tag is on the Reader, so there is no memory to read".to_string()
            }
            InfoError::Status { status } => format!(
                "the Reader reported status {status} when asked about the tag, \
                 so it was not read"
            ),
        }
    }
}

impl std::fmt::Display for InfoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message())
    }
}

impl std::error::Error for InfoError {}

/// What the Reader said about the tag, before any memory was read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NtagInfo {
    /// Tag type as the info reply reports it (`5` is an NTAG215).
    pub tag_type: u32,
    /// The tag's 7-byte UID, as hex bytes.
    pub uid: String,
    /// The 8-byte token the read request sends back unchanged.
    pub token: [u8; 8],
}

impl NtagInfo {
    /// Read one 64-byte `0x0083` payload.
    ///
    /// Pure: no hardware, so the verified offsets can be tested against a
    /// payload transcribed from docs/PROTOCOL.md.
    pub fn from_payload(payload: &[u8]) -> Result<Self, InfoError> {
        if payload.len() < INFO_REPLY_LEN {
            return Err(InfoError::WrongLength { got: payload.len() });
        }
        let status = u32::from_le_bytes([payload[0], payload[1], payload[2], payload[3]]);
        if status != INFO_STATUS_READY {
            return Err(InfoError::Status { status });
        }
        let tag_type = u32::from_le_bytes([
            payload[INFO_TAG_TYPE.start],
            payload[INFO_TAG_TYPE.start + 1],
            payload[INFO_TAG_TYPE.start + 2],
            payload[INFO_TAG_TYPE.start + 3],
        ]);
        let mut token = [0u8; 8];
        token.copy_from_slice(&payload[INFO_READ_TOKEN]);
        Ok(Self {
            tag_type,
            uid: hex(&payload[INFO_UID]),
            token,
        })
    }

    /// The tag this info describes, for the dump's header.
    pub fn identity(&self, captured_at: impl Into<String>) -> TagIdentity {
        TagIdentity::new(self.uid.clone(), self.tag_type, captured_at)
    }

    /// The 16-byte `0x0081` request: the token, the tag type, then zeros.
    ///
    /// Verified bytes, with the protocol's token of `FF` x 8 and an NTAG215's
    /// tag type:
    /// `FF FF FF FF FF FF FF FF 05 00 00 00 00 00 00 00`.
    pub fn read_request(&self) -> [u8; 16] {
        let mut payload = [0u8; 16];
        payload[..8].copy_from_slice(&self.token);
        // The protocol carries the tag type as one byte here, followed by zeros.
        payload[8] = self.tag_type as u8;
        payload
    }
}

/// Ask the Reader about the tag and return what it said.
///
/// Bounded: a Reader that does not answer, or answers with a failed checksum,
/// is an error. A queued frame from an earlier command is dropped first, so a
/// stale reply can never be read as this tag's info.
pub fn read_info(reader: &Reader) -> Result<NtagInfo, String> {
    reader.drain();
    reader.wake()?;
    let frame = reader
        .transact(
            CMD_NTAG_INFO,
            &INFO_REQUEST,
            Some(CMD_NTAG_INFO),
            INFO_TRANSACT_TIMEOUT_MS,
        )?
        .ok_or_else(|| {
            "the Reader did not answer the tag info command (0x0083). Unplug it, plug it back \
             in, and try again"
                .to_string()
        })?;
    if !frame.checksum_ok {
        return Err(format!(
            "the Reader's tag info reply failed its checksum ({}), so the tag was not read",
            hex(&frame.payload)
        ));
    }
    NtagInfo::from_payload(&frame.payload).map_err(|e| e.message())
}

/// Read the tag's memory and return the raw `0x0081` payload.
///
/// The 1284-byte payload is reassembled by `Reader` from as many reports as it
/// takes; a short payload here is a real truncation and is refused by
/// `MemoryDump::parse`, never handed on as a dump.
pub fn read_payload(reader: &Reader, info: &NtagInfo) -> Result<Vec<u8>, String> {
    let frame = reader
        .transact(
            CMD_NTAG_READ,
            &info.read_request(),
            Some(CMD_NTAG_READ),
            READ_TRANSACT_TIMEOUT_MS,
        )?
        .ok_or_else(|| {
            "the Reader did not finish reading the tag's memory (0x0081). The tag may have \
             moved, or the Reader may need replugging"
                .to_string()
        })?;
    // Progress frames and anything after the final frame are not part of the
    // dump, and must not be read as the reply to the next command.
    reader.drain();
    if !frame.checksum_ok {
        return Err(
            "the Reader's memory read failed its checksum, so there is no dump to trust"
                .to_string(),
        );
    }
    Ok(frame.payload)
}

#[cfg(test)]

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory_dump::NTAG_READ_PAYLOAD_LEN;
    use crate::reader::parse_hex;
    use crate::stream::{split_reports, ReportStream};

    /// The 17-byte NDEF message the spike's factory NTAG215 carried — PROTOCOL.md
    /// decodes it as `https://devgo.studio`: `D1 01 0D 55 04 "devgo.studio"`.
    fn recorded_message() -> Vec<u8> {
        parse_hex("D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F").unwrap()
    }

    /// The recorded user area of that Tag, pages 4..8, NUL padded to a page:
    /// `03 11 D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F FE`.
    fn recorded_user_area() -> Vec<u8> {
        parse_hex(
            "03 11 D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F FE \
             00 00 00 00 00 00 00 00 00 00 00 00",
        )
        .unwrap()
    }

    /// A `0x0081` reply payload for the recorded Tag: status 0, 256 pages, 256
    /// states, with pages 0..8 as PROTOCOL.md recorded them.
    fn recorded_read_payload() -> Vec<u8> {
        let mut payload = vec![0u8; 4 + PAGE_COUNT * PAGE_LEN + PAGE_COUNT];
        let cap_page = 4 + CC_PAGE * PAGE_LEN;
        payload[4..8].copy_from_slice(&[0x04, 0x43, 0x8A, 0x45]);
        payload[8..12].copy_from_slice(&[0x01, 0x22, 0x09, 0x03]);
        payload[12..16].copy_from_slice(&[0x29, 0x48, 0x00, 0x00]);
        payload[cap_page..cap_page + 4].copy_from_slice(&[0xE1, 0x10, 0x3E, 0x00]);
        let user = recorded_user_area();
        payload[4 + USER_FIRST_PAGE * PAGE_LEN..4 + USER_FIRST_PAGE * PAGE_LEN + user.len()]
            .copy_from_slice(&user);
        for page in 0..=8 {
            payload[4 + PAGE_COUNT * PAGE_LEN + page] = 1;
        }
        payload
    }

    // ---- the TLV wrapper, against the recorded bytes --------------------

    #[test]
    fn the_type_2_tlv_wrapper_matches_the_recorded_user_area() {
        let tlv = wrap_ndef_message(&recorded_message());
        assert_eq!(
            hex(&tlv),
            "03 11 D1 01 0D 55 04 64 65 76 67 6F 2E 73 74 75 64 69 6F FE",
            "the wrapper must reproduce the bytes that were on the Tag"
        );
        assert_eq!(tlv.len(), 20, "17-byte message plus 3 bytes of TLV overhead");
    }

    #[test]
    fn a_message_of_255_bytes_or_more_uses_the_three_byte_length_form() {
        let long = wrap_ndef_message(&vec![0xAA; 0xFF]);
        assert_eq!(&long[..4], &[NDEF_TLV, LONG_LENGTH_MARKER, 0x00, 0xFF]);
        assert_eq!(long.len(), 4 + 0xFF + 1);
        assert_eq!(*long.last().unwrap(), TERMINATOR_TLV);

        // 254 bytes is still the one-byte form: 0xFE is a length, not the
        // marker.
        let short = wrap_ndef_message(&vec![0xAA; 0xFE]);
        assert_eq!(&short[..2], &[NDEF_TLV, 0xFE]);
        assert_eq!(short.len(), 1 + 1 + 0xFE + 1);
    }

    #[test]
    fn the_recorded_user_area_reads_back_as_the_recorded_message() {
        match read_ndef_tlv(&recorded_user_area()) {
            NdefTlv::Message { message, tlv_len } => {
                assert_eq!(message, recorded_message());
                assert_eq!(tlv_len, 20, "the terminator is part of the TLV");
            }
            other => panic!("expected the recorded message, got {other:?}"),
        }
    }

    #[test]
    fn a_long_form_tlv_is_read_back_the_same_way_it_was_written() {
        let message = vec![0x5Au8; 300];
        let tlv = wrap_ndef_message(&message);
        match read_ndef_tlv(&tlv) {
            NdefTlv::Message { message: got, tlv_len } => {
                assert_eq!(got, message);
                assert_eq!(tlv_len, tlv.len());
            }
            other => panic!("expected a message, got {other:?}"),
        }
    }

    #[test]
    fn a_blank_tag_reads_as_empty_and_unformatted_memory_as_missing() {
        // The spike's factory-blank page 4 was `03 00 FE 00`.
        assert_eq!(read_ndef_tlv(&parse_hex("03 00 FE 00").unwrap()), NdefTlv::Empty);
        // Never formatted: nothing but NULL TLVs.
        assert_eq!(read_ndef_tlv(&[0u8; 16]), NdefTlv::Missing);
        // A terminator with no NDEF TLV before it.
        assert_eq!(
            read_ndef_tlv(&parse_hex("FE 00 00 00").unwrap()),
            NdefTlv::Missing
        );
    }

    #[test]
    fn a_null_tlv_before_the_ndef_tlv_is_skipped() {
        let mut user = vec![0u8; 4];
        user.extend_from_slice(&wrap_ndef_message(&recorded_message()));
        match read_ndef_tlv(&user) {
            NdefTlv::Message { message, .. } => assert_eq!(message, recorded_message()),
            other => panic!("expected the message after a NULL TLV, got {other:?}"),
        }
    }

    #[test]
    fn other_tlvs_are_skipped_to_find_the_ndef_one() {
        // A proprietary TLV that occupies memory before the NDEF TLV.
        let mut user = vec![0x04, 0x02, 0x11, 0x22];
        user.extend_from_slice(&wrap_ndef_message(&recorded_message()));
        match read_ndef_tlv(&user) {
            NdefTlv::Message { message, .. } => assert_eq!(message, recorded_message()),
            other => panic!("expected the NDEF TLV after another TLV, got {other:?}"),
        }
    }

    #[test]
    fn a_tlv_that_runs_past_the_user_memory_is_unreadable_not_truncated() {
        // Declares 17 payload bytes and carries 5: half a message must never be
        // presented as a message.
        let user = parse_hex("03 11 D1 01 0D").unwrap();
        match read_ndef_tlv(&user) {
            NdefTlv::Unreadable { reason } => assert!(!reason.is_empty()),
            other => panic!("expected unreadable, got {other:?}"),
        }
    }

    // ---- capacity from the Capability Container -------------------------

    #[test]
    fn capacity_comes_from_the_type_2_capability_container() {
        // The recorded Tag: version 1.0, 0x3E * 8 = 496 bytes.
        assert_eq!(capacity_from_cc([0xE1, 0x10, 0x3E, 0x00]), Some(496));
        assert_eq!(capacity_from_cc([0xE1, 0x10, 0x12, 0x00]), Some(144));
        // Not a Type 2 CC: capacity is unknown and is not invented.
        assert_eq!(capacity_from_cc([0x00, 0x00, 0x00, 0x00]), None);
        assert_eq!(capacity_from_cc([0xE2, 0x10, 0x3E, 0x00]), None);
    }

    #[test]
    fn the_recorded_read_payload_yields_the_recorded_tag() {
        let payload = recorded_read_payload();
        let image = MemoryImage::from_read_payload(&payload).expect("a 1284-byte reply");
        assert_eq!(image.pages(), PAGE_COUNT);
        assert_eq!(image.page(0), Some([0x04, 0x43, 0x8A, 0x45]));
        assert_eq!(image.page(CC_PAGE), Some([0xE1, 0x10, 0x3E, 0x00]));
        assert_eq!(image.state(4), Some(1));
        assert_eq!(image.user_capacity_bytes(), Some(496));
        assert_eq!(image.user_pages(), Some(124), "496 bytes is 124 pages");
        assert_eq!(&image.user_area()[..20], &recorded_user_area()[..20]);
        assert_eq!(
            image.image_bytes().len(),
            PAGE_COUNT * PAGE_LEN,
            "a write request carries 1024 page bytes, whatever the reply held"
        );
        assert_eq!(image.image_bytes()[USER_FIRST_PAGE * PAGE_LEN], 0x03);
    }

    #[test]
    fn a_short_read_payload_is_not_a_memory_image() {
        assert!(MemoryImage::from_read_payload(&[]).is_none());
        assert!(MemoryImage::from_read_payload(&[0, 0, 0, 0]).is_some(), "status only");
        let image = MemoryImage::from_read_payload(&[0, 0, 0, 0]).unwrap();
        assert_eq!(image.pages(), 0);
        assert_eq!(image.user_capacity_bytes(), None, "no CC, so no capacity");
    }

    // ---- the write request, against the spike's recorded frame ----------

    fn recorded_token() -> [u8; 8] {
        [0xFF; 8]
    }

    #[test]
    fn the_request_reproduces_the_page_write_the_spike_recorded() {
        // PROTOCOL.md: token FF*8, selector 3, flag 1, page 4 written as
        // CA FE F0 0D with state 2, and the Tag's own image carried so no other
        // page can change.
        let mut image = vec![0u8; PAGE_COUNT * PAGE_LEN];
        image[USER_FIRST_PAGE * PAGE_LEN..USER_FIRST_PAGE * PAGE_LEN + 4]
            .copy_from_slice(&[0x03, 0x00, 0xFE, 0x00]);

        let payload = write_payload(
            &recorded_token(),
            DEFAULT_TAG_SELECTOR,
            &image,
            &[(4, [0xCA, 0xFE, 0xF0, 0x0D])],
            124,
        )
        .expect("a page-4 write is a user-page write");

        assert_eq!(payload.len(), WRITE_PAYLOAD_LEN, "verified: 1328 payload bytes");
        assert_eq!(
            hex(&payload[..16]),
            "FF FF FF FF FF FF FF FF 03 00 00 00 01 00 00 00",
            "token, selector and flag as captured"
        );
        assert_eq!(&payload[0x10..0x30], &[0u8; 0x20], "the unknown block zeros");
        assert_eq!(
            &payload[0x30 + 4 * PAGE_LEN..0x30 + 4 * PAGE_LEN + 4],
            &[0xCA, 0xFE, 0xF0, 0x0D],
            "page 4 data at 0x30 + 4*4, as captured"
        );
        assert_eq!(
            &payload[0x30 + CC_PAGE * PAGE_LEN..0x30 + CC_PAGE * PAGE_LEN + 4],
            &[0u8; 4],
            "an untouched page carries the image, not new data"
        );
        assert_eq!(payload[0x430 + 4], STATE_WRITE, "page 4 state is 2, as captured");
        let states = &payload[0x430..0x530];
        assert_eq!(
            states.iter().filter(|&&b| b != 0).count(),
            1,
            "only the requested page is marked"
        );
        assert_eq!(payload[0x430], 0, "page 0 is never marked for writing");
    }

    #[test]
    fn a_write_never_marks_a_page_that_is_not_user_memory() {
        let image = vec![0u8; PAGE_COUNT * PAGE_LEN];
        for page in 0..USER_FIRST_PAGE {
            let error = write_payload(&recorded_token(), 3, &image, &[(page, [0; 4])], 124)
                .expect_err("pages 0-3 are the UID, lock bytes and CC");
            assert_eq!(error, PlanError::PageNotUser { page, user_pages: 124 });
        }
        // One past the last user page the CC declares: 4 + 124 - 1 = 127.
        let error = write_payload(&recorded_token(), 3, &image, &[(128, [0; 4])], 124)
            .expect_err("page 128 is outside the user area");
        assert_eq!(error, PlanError::PageNotUser { page: 128, user_pages: 124 });
        assert!(write_payload(&recorded_token(), 3, &image, &[(127, [0; 4])], 124).is_ok());
    }

    #[test]
    fn a_write_refuses_a_selector_the_firmware_would_refuse() {
        let image = vec![0u8; PAGE_COUNT * PAGE_LEN];
        for selector in 0..=MAX_TAG_SELECTOR {
            assert!(
                write_payload(&recorded_token(), selector, &image, &[(4, [0; 4])], 124).is_ok(),
                "selector {selector} is accepted by 0x0082"
            );
        }
        // 5 is what 0x0083 reports and what 0x0082 refuses with status 32.
        for selector in [5u32, 6, 255] {
            assert_eq!(
                write_payload(&recorded_token(), selector, &image, &[(4, [0; 4])], 124),
                Err(PlanError::SelectorOutOfRange { selector })
            );
        }
    }

    #[test]
    fn a_page_the_read_did_not_return_is_refused_rather_than_zero_filled() {
        // A 12-byte image covers pages 0..2 only, so none of its pages can be
        // written and page 4 in particular cannot be carried.
        let image = vec![0u8; 12];
        assert_eq!(
            write_payload(&recorded_token(), 3, &image, &[(4, [0; 4])], 124),
            Err(PlanError::ImageIncomplete { page: 4 })
        );
    }

    // ---- planning a whole message ---------------------------------------

    fn recorded_image() -> MemoryImage {
        MemoryImage::from_read_payload(&recorded_read_payload()).expect("recorded reply")
    }

    #[test]
    fn a_message_that_fits_is_written_as_consecutive_pages_from_page_4() {
        let plan = plan_write(
            &recorded_token(),
            &recorded_image(),
            &recorded_message(),
            DEFAULT_TAG_SELECTOR,
        )
        .expect("the recorded message fits a 496-byte Tag");

        assert_eq!(plan.required_bytes, 20, "17-byte message plus TLV overhead");
        assert_eq!(plan.capacity_bytes, 496);
        assert_eq!(plan.write_pages, vec![4, 5, 6, 7, 8], "20 bytes is five pages");
        assert_eq!(plan.expected_user, recorded_user_area()[..20].to_vec());
        assert_eq!(plan.payload.len(), WRITE_PAYLOAD_LEN);

        // Multi-page: every one of the five pages is marked 2 in one request,
        // which is exactly the shape the spike never exercised.
        let states = &plan.payload[0x430..0x530];
        for page in &plan.write_pages {
            assert_eq!(states[*page], STATE_WRITE, "page {page} marked for writing");
            let at = 0x30 + page * PAGE_LEN;
            assert_eq!(
                &plan.payload[at..at + PAGE_LEN],
                &plan.expected_user[(page - USER_FIRST_PAGE) * PAGE_LEN..(page - USER_FIRST_PAGE) * PAGE_LEN + PAGE_LEN]
            );
        }
        assert_eq!(
            states.iter().filter(|&&b| b != 0).count(),
            5,
            "no other page is marked"
        );
    }

    #[test]
    fn an_empty_message_is_refused_before_anything_is_built() {
        assert_eq!(
            plan_write(&recorded_token(), &recorded_image(), &[], DEFAULT_TAG_SELECTOR),
            Err(PlanError::EmptyMessage)
        );
    }

    #[test]
    fn a_message_over_capacity_is_refused_with_both_numbers() {
        // Long-form TLV: 4 header bytes plus the terminator. 491 bytes is 496
        // exactly and fits; 492 is one byte too many.
        assert!(plan_write(
            &recorded_token(),
            &recorded_image(),
            &vec![0x41; 491],
            DEFAULT_TAG_SELECTOR
        )
        .is_ok());
        assert_eq!(
            plan_write(
                &recorded_token(),
                &recorded_image(),
                &vec![0x41; 492],
                DEFAULT_TAG_SELECTOR
            ),
            Err(PlanError::TooLarge {
                required: 497,
                capacity: 496
            })
        );
    }

    #[test]
    fn capacity_that_cannot_be_read_is_refused_rather_than_guessed() {
        // A reply with no usable CC on page 3.
        let mut payload = recorded_read_payload();
        let cap_page = 4 + CC_PAGE * PAGE_LEN;
        payload[cap_page..cap_page + 4].copy_from_slice(&[0x00; 4]);
        let image = MemoryImage::from_read_payload(&payload).expect("decode");
        assert_eq!(image.user_capacity_bytes(), None);
        assert_eq!(
            plan_write(
                &recorded_token(),
                &image,
                &recorded_message(),
                DEFAULT_TAG_SELECTOR
            ),
            Err(PlanError::CapacityUnknown)
        );
    }

    #[test]
    fn replacing_a_longer_message_clears_the_tail_it_left_behind() {
        // The recorded Tag holds a 20-byte TLV. Writing a 6-byte one leaves 12
        // bytes of the old message after the new terminator unless the plan
        // clears them, so the plan covers the union of both regions.
        let image = recorded_image();
        let short_message = parse_hex("D1 01 04 55 04 68 69").unwrap(); // 7 bytes
        let plan = plan_write(&recorded_token(), &image, &short_message, DEFAULT_TAG_SELECTOR)
            .expect("a short message fits");

        let new_tlv = wrap_ndef_message(&short_message);
        assert_eq!(new_tlv.len(), 10, "7 + 3 bytes of TLV overhead");
        assert_eq!(plan.required_bytes, 10);
        assert_eq!(
            plan.write_pages,
            vec![4, 5, 6, 7, 8],
            "the old 20-byte region is covered, not just the new 12 bytes"
        );
        assert_eq!(
            &plan.expected_user[..10],
            &new_tlv[..],
            "the new TLV comes first, terminator included"
        );
        assert!(
            plan.expected_user[10..20].iter().all(|&b| b == 0),
            "the old message's tail is zeroed, not left readable"
        );
        // Padding to a page boundary is zeros too.
        assert_eq!(plan.expected_user.len(), 20);
    }

    #[test]
    fn writing_into_unformatted_memory_covers_only_the_new_message() {
        let mut payload = recorded_read_payload();
        let user = 4 + USER_FIRST_PAGE * PAGE_LEN;
        payload[user..user + 40].copy_from_slice(&[0u8; 40]);
        let image = MemoryImage::from_read_payload(&payload).expect("decode");
        assert_eq!(read_ndef_tlv(&image.user_area()), NdefTlv::Missing);

        let plan = plan_write(
            &recorded_token(),
            &image,
            &recorded_message(),
            DEFAULT_TAG_SELECTOR,
        )
        .expect("fits");
        assert_eq!(plan.write_pages, vec![4, 5, 6, 7, 8]);
        assert_eq!(plan.expected_user.len(), 20);
    }

    // ---- the memory-dump read path (ticket 19) ----

    const RECORDED_UID: &str = "04 43 8A 01 22 09 03";

    /// A 64-byte info reply built to the verified layout: status 4, tag type 5,
    /// the poll's UID at 0x2A and the read token at 0x38.
    fn ready_info_payload() -> Vec<u8> {
        let mut payload = vec![0u8; INFO_REPLY_LEN];
        payload[0..4].copy_from_slice(&INFO_STATUS_READY.to_le_bytes());
        payload[INFO_TAG_TYPE].copy_from_slice(&5u32.to_le_bytes());
        let uid = crate::reader::parse_hex(RECORDED_UID).expect("uid");
        payload[INFO_UID].copy_from_slice(&uid);
        payload[INFO_READ_TOKEN].copy_from_slice(&[0xFF; 8]);
        payload
    }

    #[test]
    fn the_info_request_is_the_verified_six_bytes() {
        assert_eq!(INFO_REQUEST, [0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
    }

    #[test]
    fn the_read_request_is_the_verified_sixteen_bytes() {
        let info = NtagInfo::from_payload(&ready_info_payload()).expect("ready info");
        assert_eq!(
            hex(&info.read_request()),
            "FF FF FF FF FF FF FF FF 05 00 00 00 00 00 00 00",
            "docs/PROTOCOL.md records exactly this 0x0081 payload"
        );
    }

    #[test]
    fn a_ready_info_reply_yields_the_reported_uid_and_read_token() {
        let info = NtagInfo::from_payload(&ready_info_payload()).expect("status 4 is ready");

        assert_eq!(info.tag_type, 5);
        assert_eq!(info.uid, RECORDED_UID);
        assert_eq!(info.token, [0xFF; 8]);
        assert_eq!(
            info.identity("2026-11-21T09:30:00.000Z").tag_label,
            "NTAG215"
        );
    }

    #[test]
    fn a_tag_that_does_not_answer_is_reported_not_parsed() {
        let mut payload = ready_info_payload();
        payload[0..4].copy_from_slice(&INFO_STATUS_NONE.to_le_bytes());

        let refused = NtagInfo::from_payload(&payload).expect_err("no tag has no info");
        assert_eq!(refused, InfoError::Status { status: 1 });
        assert!(
            refused.message().contains("no 13.56 MHz tag"),
            "{}",
            refused.message()
        );
    }

    #[test]
    fn a_status_other_than_tag_ready_is_never_read_as_a_tag() {
        for status in [0u32, 2, 3, 32] {
            let mut payload = ready_info_payload();
            payload[0..4].copy_from_slice(&status.to_le_bytes());

            let refused = NtagInfo::from_payload(&payload).expect_err("not ready");
            assert_eq!(refused, InfoError::Status { status });
            assert!(refused.message().contains(&format!("status {status}")));
        }
    }

    #[test]
    fn a_short_info_reply_is_refused_by_length() {
        let short = vec![0u8; INFO_REPLY_LEN - 1];
        assert_eq!(
            NtagInfo::from_payload(&short),
            Err(InfoError::WrongLength {
                got: INFO_REPLY_LEN - 1
            })
        );
    }

    #[test]
    fn progress_frames_are_not_the_dump_and_the_dump_arrives_last() {
        // The read emits one 0x0085 per page and then one 0x0081 with the whole
        // dump. The stream keeps them apart, and the read path waits for the
        // 0x0081 — so a progress frame can never be formatted as a dump.
        let mut bytes = Vec::new();
        for page in 0..3u8 {
            bytes.extend_from_slice(&encode_frame(
                CMD_NTAG_PAGE,
                &[page, 1, 0xDE, 0xAD, 0xBE, 0xEF],
            ));
        }
        let dump_payload = vec![0u8; NTAG_READ_PAYLOAD_LEN];
        bytes.extend_from_slice(&encode_frame(CMD_NTAG_READ, &dump_payload));

        let reports = split_reports(&bytes);
        assert_eq!(
            reports.len(),
            21,
            "progress frames plus the dump, in reports"
        );

        let mut stream = ReportStream::new();
        let mut frames = Vec::new();
        for report in &reports {
            stream.push(report);
            while let Some(frame) = stream.next_frame() {
                frames.push(frame);
            }
        }

        let progress: Vec<_> = frames.iter().filter(|f| f.cmd == CMD_NTAG_PAGE).collect();
        let dumps: Vec<_> = frames.iter().filter(|f| f.cmd == CMD_NTAG_READ).collect();
        assert_eq!(progress.len(), 3, "three progress frames, each 6 bytes");
        assert!(progress.iter().all(|f| f.payload.len() == 6));
        assert_eq!(dumps.len(), 1, "one final frame carries the dump");
        assert_eq!(dumps[0].payload.len(), NTAG_READ_PAYLOAD_LEN);
        assert_eq!(frames.last().expect("a last frame").cmd, CMD_NTAG_READ);
        assert_eq!(stream.take_error(), None);
    }
}

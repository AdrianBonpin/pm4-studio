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
use crate::write_outcome::{classify_erase, classify_evidence, JudgedEvidence, WriteOutcome};

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
/// The bytes an erase writes: an NDEF TLV whose message is zero bytes. A Type 2
/// Tag holding this is a valid, formatted Tag that carries no Records — not a
/// Blank Tag, and not an unformatted one.
pub const EMPTY_NDEF_TLV: [u8; 3] = [NDEF_TLV, 0x00, TERMINATOR_TLV];
/// Length byte meaning "a two-byte length follows".
pub const LONG_LENGTH_MARKER: u8 = 0xFF;

/// `0x0083` status: NTAG ready and info complete.
pub const STATUS_READY: u32 = INFO_STATUS_READY;
/// `0x0083` status: nothing latched.
pub const STATUS_NO_TAG: u32 = INFO_STATUS_NONE;
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
    /// The user memory carries no NDEF TLV at all, so there is no content to
    /// erase. Writing an empty TLV into unformatted memory would be a format,
    /// not an erase.
    NothingToErase,
    /// The user memory already carries a zero-length NDEF TLV, so an erase would
    /// write the same bytes back to a Tag that has nothing to lose.
    AlreadyErased,
    /// The TLV on the Tag could not be parsed, so which bytes an erase would
    /// have to clear is unknown. Guessing would leave a message tail behind.
    ContentUnreadable { reason: String },
    /// The CC on page 3 did not yield a capacity.
    CapacityUnknown,
    /// The TLV does not fit the Tag's user memory.
    TooLarge { required: usize, capacity: usize },
    /// A page that holds UID, BCC, lock bytes or the CC, or one past the user
    /// area. Writing any of them corrupts the Tag.
    PageNotUser { page: usize, user_pages: usize },
    /// A page in the configuration area (`AUTH0`, `PWD`, `PACK`, lock bytes).
    /// Never user memory, whatever the Capability Container claims: writing one
    /// can enable password protection that this Reader cannot undo.
    PageIsConfiguration { page: usize },
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
            PlanError::NothingToErase => write!(
                f,
                "the tag carries no NDEF message, so there is nothing to erase"
            ),
            PlanError::AlreadyErased => write!(
                f,
                "the tag already carries an empty NDEF message, so there is nothing to erase"
            ),
            PlanError::ContentUnreadable { reason } => write!(
                f,
                "the tag's NDEF content could not be read ({reason}), so the bytes an erase \
                 would have to clear are unknown"
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
            PlanError::PageIsConfiguration { page } => write!(
                f,
                "page {page} is configuration, not user memory. Pages {} and above hold \
                 lock bytes and password settings (AUTH0, PWD, PACK), which a message write \
                 must never change",
                CONFIG_FIRST_PAGE
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

/// First page of the NTAG21x configuration area. Pages from here on hold lock
/// bytes and the password settings (`AUTH0`, `PWD`, `PACK`), so they are never
/// user memory — not even when a Tag's Capability Container claims otherwise.
/// `src-tauri/src/password.rs` decides what may be done with them, which on
/// this Reader is nothing.
pub const CONFIG_FIRST_PAGE: usize = 130;

/// The guard that stops an NDEF write reaching the UID, the lock bytes, the
/// Capability Container or the configuration area.
///
/// Pages 0..3 hold the UID, lock bytes and CC; user memory runs from page 4 for
/// as many pages as the CC declares, **clamped at the configuration area**. The
/// clamp is not redundant: `user_pages` comes from the Tag's own
/// Capability Container, so a Tag claiming a large capacity would otherwise be
/// able to steer a message write into `AUTH0`/`PWD`/`PACK` on pages 131-134.
/// Enabling password protection there is unrecoverable over this protocol; see
/// `password.rs`.
fn guard_write_page(page: usize, user_pages: usize) -> Result<(), PlanError> {
    if page >= CONFIG_FIRST_PAGE {
        return Err(PlanError::PageIsConfiguration { page });
    }
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

// ---- erasing a Tag's NDEF content (ticket 20) --------------------------
//
// Erasing is writing an empty NDEF TLV (`03 00 FE`) over the message area. It is
// deliberately not a format and not a zeroing of user memory:
//
//   * the Capability Container on page 3 stays exactly as it was, so the Tag is
//     still a Type 2 Tag of the same size;
//   * the UID, the lock bytes and the CC are never written, because every page
//     write goes through `guard_write_page`;
//   * whatever the old message occupied is covered too, so a leftover tail
//     cannot be read back behind the new terminator.
//
// The result is a Tag that is present and readable with **no Records**, which is
// the whole point: erasing clears content, it does not destroy the Tag.

/// One ready-to-send erase: the 1328-byte payload, the pages it changes, and
/// what those pages must read back as.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErasePlan {
    pub payload: Vec<u8>,
    /// Pages marked `2` in the state table, in order.
    pub write_pages: Vec<usize>,
    /// The bytes pages [`Self::write_pages`] must hold afterwards, flattened:
    /// `03 00 FE` followed by zeros out to the old message's last page.
    pub expected_user: Vec<u8>,
    /// Bytes of the old NDEF TLV that the erase clears, header and terminator
    /// included. This is what the confirmation says will be lost.
    pub cleared_bytes: usize,
    /// User memory the CC declared.
    pub capacity_bytes: usize,
}

impl ErasePlan {
    /// The bytes written over the message area, as the erase request carries
    /// them. Exposed so a probe or a report can quote the actual bytes.
    pub fn written_hex(&self) -> String {
        hex(&self.expected_user)
    }
}

/// The page-aligned region an erase must write, plus how many bytes of the old
/// TLV it clears.
///
/// The region is the union of the new empty TLV and the message that is there
/// now, so an old, longer message's tail is zeroed rather than left readable.
/// Nothing here reads the clock or the device, so the bytes are testable against
/// the user areas recorded in docs/PROTOCOL.md.
fn erase_region(image: &MemoryImage) -> Result<(Vec<u8>, usize), PlanError> {
    let previous_len = match read_ndef_tlv(&image.user_area()) {
        NdefTlv::Message { tlv_len, .. } => tlv_len,
        NdefTlv::Empty => return Err(PlanError::AlreadyErased),
        NdefTlv::Missing => return Err(PlanError::NothingToErase),
        NdefTlv::Unreadable { reason } => return Err(PlanError::ContentUnreadable { reason }),
    };
    let mut region = pad_to_page(EMPTY_NDEF_TLV.to_vec());
    let previous_region = pad_to_page_len(previous_len);
    if previous_region > region.len() {
        region.resize(previous_region, 0);
    }
    Ok((region, previous_len))
}

/// Build the `0x0082` request that clears a Tag's NDEF content.
///
/// A Tag whose content cannot be read is refused before a frame exists: without
/// knowing which bytes the old TLV occupies, an erase cannot promise to clear it
/// and could leave a message tail behind a new terminator.
pub fn plan_erase(
    token: &[u8; 8],
    image: &MemoryImage,
    selector: u32,
) -> Result<ErasePlan, PlanError> {
    if selector > MAX_TAG_SELECTOR {
        return Err(PlanError::SelectorOutOfRange { selector });
    }
    let capacity_bytes = image.user_capacity_bytes().ok_or(PlanError::CapacityUnknown)?;
    let user_pages = capacity_bytes / PAGE_LEN;
    let (region, cleared_bytes) = erase_region(image)?;
    if region.len() > capacity_bytes {
        return Err(PlanError::TooLarge {
            required: region.len(),
            capacity: capacity_bytes,
        });
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

    let payload = write_payload(token, selector, &image.image_bytes(), &writes, user_pages)?;

    Ok(ErasePlan {
        payload,
        write_pages,
        expected_user: region,
        cleared_bytes,
        capacity_bytes,
    })
}

/// What a post-erase read showed, as two separate facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EraseReadback {
    /// User memory carries a valid, zero-length NDEF TLV. A truncated or
    /// unparseable TLV is not this.
    pub content_cleared: bool,
    /// Pages 0..=3 — UID, BCC, static lock bytes and the Capability Container —
    /// read exactly as they did before the erase.
    pub identity_intact: bool,
}

impl EraseReadback {
    /// True only when both facts hold: the Tag is present with no Records and
    /// its identity and Capability Container are untouched.
    pub fn is_erased(self) -> bool {
        self.content_cleared && self.identity_intact
    }
}

/// Compare the memory read before an erase with the one after it.
///
/// The Capability Container check is the answer to "did the erase change the
/// Tag's format": page 3 must be byte-identical. A page that either read did not
/// return is not "intact" — an unobserved page is not evidence of an unchanged
/// one.
pub fn judge_erase_readback(before: &MemoryImage, after: &MemoryImage) -> EraseReadback {
    let content_cleared = matches!(read_ndef_tlv(&after.user_area()), NdefTlv::Empty);
    let identity_intact = (0..=CC_PAGE).all(|page| match (before.page(page), after.page(page)) {
        (Some(was), Some(now)) => was == now,
        _ => false,
    });
    EraseReadback {
        content_cleared,
        identity_intact,
    }
}


// ---- one read of the Tag -------------------------------------------------

/// One whole read: the info reply and the memory dump that followed it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagRead {
    pub info: NtagInfo,
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
            uid: read.info.uid.clone(),
            reported_tag_type: read.info.tag_type,
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

    let info = NtagInfo::parse(&info_frame.payload).map_err(|e| e.message())?;
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
    read_payload.push(info.tag_type as u8);
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
    /// Every reply frame this write produced, as `cmd payload-hex` pairs. Kept so
    /// a probe can quote the reply bytes rather than only their interpretation:
    /// `stream::encode_frame` turns each pair back into the exact frame, because
    /// a frame is its command, its payload and a checksum derived from them.
    pub frames: Vec<String>,
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
    let mut frames = Vec::new();
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
            frames.push(format!("{:04X} {}", frame.cmd, hex(&frame.payload)));
        } else if frame.cmd == CMD_NTAG_WRITE && frame.payload.len() >= 4 {
            let status = u32::from_le_bytes([
                frame.payload[0],
                frame.payload[1],
                frame.payload[2],
                frame.payload[3],
            ]);
            frames.push(format!("{:04X} {}", frame.cmd, hex(&frame.payload)));
            return Ok(Some(WriteReply {
                status,
                progress,
                frames,
            }));
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
        // Nor can it erase: `write_message` refuses an empty message, and erasing
        // is `erase_ndef`'s job. Named rather than defaulted for the same reason.
        WriteOutcome::Erased => Some(
            "the write reported an erased Tag, which a Draft write cannot produce".to_string(),
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

// ---- erasing a Tag's NDEF content (ticket 20) ---------------------------

/// The sentence a refusal says when nothing is latched during an erase.
pub const NO_TAG_ERASE_MESSAGE: &str =
    "no 13.56 MHz Tag is in the field, so there is nothing to erase";

/// What an erase would clear, without clearing it. Reads the Tag, so the
/// confirmation can name what would be lost.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErasePreview {
    /// What the Tag holds now. `None` when nothing could be read.
    pub tag: Option<TagView>,
    /// Bytes of the current NDEF TLV an erase would clear, terminator included.
    pub clears_bytes: usize,
    /// User pages the erase would write: `03 00 FE` plus the old message's tail.
    pub pages: Vec<usize>,
    pub capacity_bytes: Option<usize>,
    /// True only when an erase would proceed, so the UI can never show a
    /// confirmation for an erase that would be refused.
    pub can_erase: bool,
    /// Why the erase would not proceed, when it would not.
    pub refusal: Option<String>,
}

/// Read the Tag and answer what erasing its NDEF content would do to it.
///
/// Read-only: the info and memory read commands only. A Tag that cannot be read
/// is a refusal here, before any write frame could exist.
pub fn preview_erase(reader: &Reader) -> ErasePreview {
    let mut preview = ErasePreview {
        tag: None,
        clears_bytes: 0,
        pages: Vec::new(),
        capacity_bytes: None,
        can_erase: false,
        refusal: None,
    };

    let read = match read_tag(reader) {
        Ok(Some(read)) => read,
        Ok(None) => {
            preview.refusal = Some(NO_TAG_ERASE_MESSAGE.to_string());
            return preview;
        }
        Err(e) => {
            preview.refusal = Some(format!("the Tag could not be read: {e}"));
            return preview;
        }
    };
    preview.capacity_bytes = read.memory.user_capacity_bytes();
    preview.tag = Some(TagView::from_read(&read));

    match plan_erase(&read.info.token, &read.memory, DEFAULT_TAG_SELECTOR) {
        Ok(plan) => {
            preview.clears_bytes = plan.cleared_bytes;
            preview.pages = plan.write_pages;
            preview.can_erase = true;
        }
        Err(error) => {
            preview.refusal = Some(error.to_string());
        }
    }
    preview
}

/// The decision an erase makes about the read that precedes it, as a pure
/// function so the fail-closed rule is testable with no hardware (ADR 0001).
///
/// A Tag that cannot be read is a refusal, not a warning: an erase that does not
/// know what is on the Tag cannot promise to clear it, and the same reasoning
/// that made a blind 125 kHz write unacceptable applies to writing over an NDEF
/// message the app never saw.
pub fn erase_target(read: Result<Option<TagRead>, String>) -> Result<TagRead, String> {
    match read {
        Ok(Some(read)) => Ok(read),
        Ok(None) => Err(NO_TAG_ERASE_MESSAGE.to_string()),
        Err(e) => Err(format!(
            "the Tag could not be read, so nothing was erased: {e}"
        )),
    }
}

/// One attempted erase, with everything the UI needs to say what happened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EraseReport {
    /// What the Tag held before the erase, from the read this path is required
    /// to do first. `None` when nothing was read.
    pub before: Option<TagView>,
    pub outcome: WriteOutcome,
    /// Why the content was not cleared, when it was not.
    pub message: Option<String>,
    pub capacity_bytes: Option<usize>,
    /// Bytes of the old NDEF TLV the erase cleared.
    pub cleared_bytes: usize,
    /// Pages the request asked the firmware to write.
    pub erase_pages: Vec<usize>,
    /// Pages the firmware reported it wrote.
    pub accepted_pages: Vec<usize>,
    /// What the Tag read back as afterwards, when it could be re-read.
    pub readback: Option<TagView>,
    /// Pages 0..=3 read identically before and after. `None` when there was no
    /// before/after pair to compare.
    pub identity_intact: Option<bool>,
    /// The bytes written over the message area, hex. A report is evidence: this
    /// is the actual content of the erase, not a summary of it.
    pub written_hex: String,
    /// The whole `0x0082` frame as it was sent, hex: header, token, selector,
    /// the tag's image, and the 256-byte state table. Kept for the hardware probe
    /// because ticket 18's multi-page evidence was not auditable without the
    /// request and reply bytes; it is deliberately not serialised to the webview.
    pub request_hex: String,
    /// The reply frames as `cmd payload-hex` pairs, and the status the final
    /// `0x0082` frame carried. Evidence, not interpretation.
    pub reply_frames: Vec<String>,
    pub reply_status: Option<u32>,
}

impl EraseReport {
    fn refused(message: String) -> Self {
        EraseReport {
            before: None,
            outcome: WriteOutcome::Refused,
            message: Some(message),
            capacity_bytes: None,
            cleared_bytes: 0,
            erase_pages: Vec::new(),
            accepted_pages: Vec::new(),
            readback: None,
            identity_intact: None,
            written_hex: String::new(),
            request_hex: String::new(),
            reply_frames: Vec::new(),
            reply_status: None,
        }
    }
}

/// Clear the NDEF content of the Tag on the Reader, then read it back.
///
/// The order is the same fail-closed shape ADR 0001 established for 125 kHz and
/// ticket 18 kept for NDEF writes, and each step is a refusal rather than a
/// risk:
///
/// 1. The Tag is read. If it cannot be read, nothing is written: an erase that
///    does not know what is there cannot promise to clear it.
/// 2. The plan refuses a Tag with no NDEF TLV (that would be a format, not an
///    erase), one whose TLV cannot be parsed, and one whose capacity cannot be
///    read — all before a write frame exists.
/// 3. The frame is sent as 21 reports with the pacing the spike proved. Only
///    user pages from page 4 are marked, so the UID, lock bytes and Capability
///    Container are never written.
/// 4. The Tag is read back. A read-back that shows a valid empty NDEF TLV **and**
///    pages 0..=3 unchanged is `Erased` — its own word, never `Verified`, because
///    clearing content places no copy. A read-back that shows content or a
///    changed Capability Container is `Failed`; a Tag that cannot be read back
///    at all is `Unverified`, which the UI says as "unknown".
pub fn erase_ndef(reader: &Reader) -> EraseReport {
    let read = match erase_target(read_tag(reader)) {
        Ok(read) => read,
        Err(message) => return EraseReport::refused(message),
    };

    let mut report = EraseReport {
        before: Some(TagView::from_read(&read)),
        outcome: WriteOutcome::Refused,
        message: None,
        capacity_bytes: read.memory.user_capacity_bytes(),
        cleared_bytes: 0,
        erase_pages: Vec::new(),
        accepted_pages: Vec::new(),
        readback: None,
        identity_intact: None,
        written_hex: String::new(),
        request_hex: String::new(),
        reply_frames: Vec::new(),
        reply_status: None,
    };

    let plan = match plan_erase(&read.info.token, &read.memory, DEFAULT_TAG_SELECTOR) {
        Ok(plan) => plan,
        Err(error) => {
            report.message = Some(error.to_string());
            return report;
        }
    };
    report.cleared_bytes = plan.cleared_bytes;
    report.erase_pages = plan.write_pages.clone();
    report.written_hex = plan.written_hex();

    // The same pauses ticket 18 uses: read, settle, write, settle, read back.
    std::thread::sleep(std::time::Duration::from_millis(WRITE_SETTLE_MS));
    let frame = encode_frame(CMD_NTAG_WRITE, &plan.payload);
    report.request_hex = hex(&frame);
    reader.drain();
    if let Err(e) = reader.write_frame_paced(
        &frame,
        std::time::Duration::from_millis(REPORT_GAP_MS),
    ) {
        report.outcome = WriteOutcome::Failed;
        report.message = Some(format!("the erase could not be sent: {e}"));
        return report;
    }

    let reply = collect_write_reply(reader, WRITE_TIMEOUT_MS).unwrap_or(None);
    if let Some(reply) = &reply {
        report.accepted_pages = reply.written_pages();
        report.reply_frames = reply.frames.clone();
        report.reply_status = Some(reply.status);
    }
    let declined = reply
        .as_ref()
        .map(|reply| reply.status == STATUS_REFUSED)
        .unwrap_or(false);

    std::thread::sleep(std::time::Duration::from_millis(READBACK_SETTLE_MS));
    let readback = read_tag(reader);
    let judged = match &readback {
        Ok(Some(after)) => {
            let facts = judge_erase_readback(&read.memory, &after.memory);
            report.identity_intact = Some(facts.identity_intact);
            report.readback = Some(TagView::from_read(after));
            Some(facts)
        }
        _ => {
            report.readback = None;
            None
        }
    };

    report.outcome = if declined {
        // The firmware said it would not act, and PROTOCOL.md records status 32
        // as nothing written — not a Tag whose contents are unknown.
        classify_erase(JudgedEvidence::NotTransmitted)
    } else {
        match &judged {
            // Sent, and the Tag could not be read again: unknown.
            None => classify_erase(JudgedEvidence::Readback(None)),
            Some(facts) => classify_erase(JudgedEvidence::Readback(Some(facts.is_erased()))),
        }
    };

    report.message = match report.outcome {
        WriteOutcome::Erased => None,
        WriteOutcome::Refused => report
            .message
            .or_else(|| Some("the erase was not attempted".to_string())),
        WriteOutcome::Failed if declined => Some(format!(
            "the reader refused the erase request (status {STATUS_REFUSED}), which it \
             answers for a parameter it will not accept. Nothing was written."
        )),
        WriteOutcome::Failed => Some(match &judged {
            Some(facts) if !facts.identity_intact => {
                "the tag did not read back with its UID and Capability Container unchanged, \
                 so the erase is not reported as a success. Re-read the tag before using it."
                    .to_string()
            }
            Some(_) => "the tag still reads back with an NDEF message, so the erase did not \
                         take. The tag is still readable."
                .to_string(),
            None => report
                .message
                .clone()
                .unwrap_or_else(|| "the erase could not be sent".to_string()),
        }),
        WriteOutcome::Unverified => Some(
            "the erase was sent but the Tag could not be read back, so what it holds is unknown"
                .to_string(),
        ),
        // An erase cannot blank a Tag's 125 kHz Identity, and it does not verify
        // a copy. Both arms are unreachable; naming them keeps a future change to
        // the shared vocabulary from silently wording an erase as a write.
        WriteOutcome::Blanked => Some(
            "the erase reported a blanked Tag, which clearing NDEF content cannot produce"
                .to_string(),
        ),
        WriteOutcome::Verified => Some(
            "the erase reported a verified write, which clearing NDEF content cannot produce"
                .to_string(),
        ),
    };

    report
}


// ---- the memory-dump read path (ticket 19) -------------------------------
//
// `MemoryDump::parse` wants the raw `0x0081` payload and a `TagIdentity` for its
// header. This section used to carry its own `0x0083` reply parser (built for
// ticket 19) while the read/write path carried another (ticket 18), which meant
// two parses of the same offsets. There is now one: `NtagInfo`, whose fields are
// the union of what both paths need. The status dword is kept rather than
// rejected inside the parser, because "nothing latched" is a Reader state the
// read path has to tell apart from an unusable reply.

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
///
/// One parser for the whole `0x0083` reply: the read path, the write path, the
/// erase path and the memory dump all read it through this type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NtagInfo {
    /// Status dword: 4 = ready, 1 = nothing latched, 32 = refused.
    pub status: u32,
    /// Tag type as the info reply reports it (`5` is an NTAG215). Deliberately
    /// kept apart from the write-path selector: `0x0082` refuses this value.
    pub tag_type: u32,
    /// The tag's 7-byte UID at payload 0x2A..0x31, as space-separated hex.
    pub uid: String,
    /// The 8-byte token the read and write requests send back unchanged.
    pub token: [u8; 8],
}

impl NtagInfo {
    /// Read one 64-byte `0x0083` payload, whatever its status dword says.
    ///
    /// Pure: no hardware, so the verified offsets can be tested against a
    /// payload transcribed from docs/PROTOCOL.md. The status is reported rather
    /// than enforced here, because "no tag latched" is a fact about the Reader
    /// and `from_payload` is the caller that wants it refused.
    pub fn parse(payload: &[u8]) -> Result<Self, InfoError> {
        if payload.len() < INFO_REPLY_LEN {
            return Err(InfoError::WrongLength { got: payload.len() });
        }
        let status = u32::from_le_bytes([payload[0], payload[1], payload[2], payload[3]]);
        let tag_type = u32::from_le_bytes([
            payload[INFO_TAG_TYPE.start],
            payload[INFO_TAG_TYPE.start + 1],
            payload[INFO_TAG_TYPE.start + 2],
            payload[INFO_TAG_TYPE.start + 3],
        ]);
        let mut token = [0u8; 8];
        token.copy_from_slice(&payload[INFO_READ_TOKEN]);
        Ok(Self {
            status,
            tag_type,
            uid: hex(&payload[INFO_UID]),
            token,
        })
    }

    /// Read one 64-byte `0x0083` payload and refuse anything but a ready tag.
    ///
    /// Pure: no hardware, so the verified offsets can be tested against a
    /// payload transcribed from docs/PROTOCOL.md.
    pub fn from_payload(payload: &[u8]) -> Result<Self, InfoError> {
        let info = Self::parse(payload)?;
        if info.status != INFO_STATUS_READY {
            return Err(InfoError::Status {
                status: info.status,
            });
        }
        Ok(info)
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
    fn a_capability_container_cannot_open_the_configuration_area() {
        let image = vec![0u8; PAGE_COUNT * PAGE_LEN];
        // A CC that claims the whole 256-page image as user memory: without the
        // clamp, pages 131-134 would pass the user-memory guard and a message
        // write could set AUTH0/PWD/PACK.
        for page in CONFIG_FIRST_PAGE..PAGE_COUNT {
            assert_eq!(
                write_payload(&recorded_token(), 3, &image, &[(page, [0; 4])], 252),
                Err(PlanError::PageIsConfiguration { page }),
                "page {page} is configuration"
            );
        }
        assert!(write_payload(&recorded_token(), 3, &image, &[(129, [0; 4])], 252).is_ok());
    }

    #[test]
    fn the_configuration_refusal_names_the_page_and_the_reason() {
        let message = PlanError::PageIsConfiguration { page: 131 }.to_string();
        assert!(message.contains("page 131"), "{message}");
        assert!(message.contains("AUTH0"), "{message}");
        assert!(message.contains("password"), "{message}");
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

    // ---- erasing a Tag's NDEF content (ticket 20) ----------------------
    //
    // Every byte below comes from docs/PROTOCOL.md: the spike's user area
    // (`03 11 D1 01 0D 55 04 "devgo.studio" FE`) and ticket 18's recorded
    // multi-page writes (a 9-byte Text message over three pages, a 47-byte one
    // over thirteen). No hardware is involved, so the erase payload and the
    // read-back judgement are checked against bytes that were actually on a Tag.

    /// The user area of ticket 18's third recorded write: the 9-byte Text
    /// message, `03 09 D1 01 54 05 02 65 6E 68 69 FE`, over pages 4..6, with
    /// pages 7..16 zeroed because the request cleared the 47-byte message's tail.
    fn ticket_18_three_page_user_area() -> Vec<u8> {
        let mut user = parse_hex("03 09 D1 01 54 05 02 65 6E 68 69 FE").unwrap();
        user.resize(52, 0); // 13 pages: 4..16 inclusive, as that read-back showed
        user
    }

    /// The 47-byte Text message ticket 18 wrote over 13 pages, as its TLV:
    /// `03 2F` then 47 message bytes then `FE` = 50 bytes, padded to 52.
    fn ticket_18_thirteen_page_user_area() -> Vec<u8> {
        let message = vec![0x41u8; 47];
        let mut user = wrap_ndef_message(&message);
        assert_eq!(user.len(), 50, "4 bytes of TLV overhead plus the terminator");
        user.resize(52, 0);
        user
    }

    /// A read payload carrying an arbitrary user area, everything else as the
    /// recorded Tag had it (pages 0..3, states, capacity).
    fn read_payload_with_user_area(user: &[u8]) -> Vec<u8> {
        let mut payload = recorded_read_payload();
        let start = 4 + USER_FIRST_PAGE * PAGE_LEN;
        let end = start + RECORDED_USER_BYTES;
        payload[start..end].fill(0);
        payload[start..start + user.len()].copy_from_slice(user);
        payload
    }

    /// The user memory a `0x0081` reply carries for the recorded Tag: 124 pages.
    const RECORDED_USER_BYTES: usize = 496;

    fn image_with_user_area(user: &[u8]) -> MemoryImage {
        MemoryImage::from_read_payload(&read_payload_with_user_area(user)).expect("recorded reply")
    }

    #[test]
    fn an_erase_writes_the_empty_ndef_tlv_over_the_recorded_message() {
        // The recorded Tag holds a 20-byte TLV across pages 4..8. An erase writes
        // `03 00 FE` and zeros out the rest of that region, touching nothing else.
        let plan = plan_erase(&recorded_token(), &recorded_image(), DEFAULT_TAG_SELECTOR)
            .expect("a Tag holding a message can be erased");

        assert_eq!(plan.cleared_bytes, 20, "the recorded TLV, terminator included");
        assert_eq!(plan.write_pages, vec![4, 5, 6, 7, 8]);
        assert_eq!(plan.capacity_bytes, 496);
        assert_eq!(
            hex(&plan.expected_user[..3]),
            "03 00 FE",
            "erasing writes an empty NDEF TLV, not zeros"
        );
        assert!(
            plan.expected_user[3..].iter().all(|&b| b == 0),
            "the old message's bytes are cleared behind the new terminator"
        );
        assert_eq!(plan.expected_user.len(), 20, "page aligned to the old region");
        assert_eq!(plan.payload.len(), WRITE_PAYLOAD_LEN);
        assert_eq!(
            hex(&plan.payload[..16]),
            "FF FF FF FF FF FF FF FF 03 00 00 00 01 00 00 00",
            "token, selector and flag exactly as the accepted write frame carried them"
        );
        assert_eq!(
            &plan.payload[0x30 + USER_FIRST_PAGE * PAGE_LEN..0x30 + USER_FIRST_PAGE * PAGE_LEN + 4],
            &[NDEF_TLV, 0x00, TERMINATOR_TLV, 0x00],
            "page 4 carries 03 00 FE 00"
        );
        assert_eq!(
            hex(&plan.expected_user),
            "03 00 FE 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00",
            "the erase as bytes: header, terminator, then zeros"
        );
    }

    #[test]
    fn an_erase_marks_only_the_pages_the_old_message_occupied() {
        // Erasing is not a format and not a wipe of user memory: a page the old
        // message never reached is not written at all.
        let plan = plan_erase(&recorded_token(), &recorded_image(), DEFAULT_TAG_SELECTOR)
            .expect("erasable");
        let states = &plan.payload[0x430..0x530];
        for page in &plan.write_pages {
            assert_eq!(states[*page], STATE_WRITE, "page {page} marked for writing");
        }
        assert_eq!(
            states.iter().filter(|&&b| b != 0).count(),
            plan.write_pages.len(),
            "no page outside the old message's region is marked"
        );
        for page in 0..USER_FIRST_PAGE {
            assert_eq!(states[page], 0, "page {page} is never marked for writing");
        }
        for page in 9..=127 {
            assert_eq!(states[page], 0, "page {page} holds no message and is untouched");
        }
    }

    #[test]
    fn an_erase_carries_the_capability_container_unchanged_and_does_not_mark_it() {
        // Pages 0..3 are the UID, BCC, static lock bytes and the Type 2 CC. The
        // request carries the Tag's image, so page 3 rides along — but its state
        // stays 0, which is what stops the firmware writing it.
        let image = recorded_image();
        let plan = plan_erase(&recorded_token(), &image, DEFAULT_TAG_SELECTOR).expect("erasable");
        let at = 0x30 + CC_PAGE * PAGE_LEN;
        assert_eq!(&plan.payload[at..at + PAGE_LEN], &[0xE1, 0x10, 0x3E, 0x00]);
        assert_eq!(plan.payload[0x430 + CC_PAGE], 0, "the CC page is not written");
        assert_eq!(image.user_capacity_bytes(), Some(496), "still a Type 2 Tag");
    }

    #[test]
    fn erasing_ticket_18s_three_page_message_covers_exactly_those_pages() {
        // Ticket 18 recorded a 9-byte Text message at pages 4..6 with pages 7..16
        // zeroed. Erasing it writes three pages, not thirteen.
        let image = image_with_user_area(&ticket_18_three_page_user_area());
        assert_eq!(
            read_ndef_tlv(&image.user_area()),
            NdefTlv::Message {
                message: parse_hex("D1 01 54 05 02 65 6E 68 69").unwrap(),
                tlv_len: 12,
            }
        );
        let plan = plan_erase(&recorded_token(), &image, DEFAULT_TAG_SELECTOR).expect("erasable");
        assert_eq!(plan.cleared_bytes, 12);
        assert_eq!(plan.write_pages, vec![4, 5, 6]);
        assert_eq!(plan.expected_user.len(), 12);
        assert_eq!(
            hex(&plan.expected_user),
            "03 00 FE 00 00 00 00 00 00 00 00 00",
            "three pages of empty TLV, zero filled"
        );
        // The protocol's recorded read-back of this Tag: pages 4..6 were the
        // message, so the erase's region is exactly those pages.
        assert_eq!(plan.payload[0x430 + 7], 0);
    }

    #[test]
    fn erasing_ticket_18s_thirteen_page_message_covers_thirteen_pages() {
        // The multi-page case the ticket asks to be recorded: a 47-byte message
        // occupied pages 4..16, so the erase does too.
        let image = image_with_user_area(&ticket_18_thirteen_page_user_area());
        let plan = plan_erase(&recorded_token(), &image, DEFAULT_TAG_SELECTOR).expect("erasable");
        assert_eq!(plan.cleared_bytes, 50);
        assert_eq!(plan.write_pages, (4..=16).collect::<Vec<_>>());
        assert_eq!(plan.expected_user.len(), 52, "50 bytes pads to 13 pages");
        assert_eq!(hex(&plan.expected_user[..4]), "03 00 FE 00");
        assert!(plan.expected_user[4..].iter().all(|&b| b == 0));
        let states = &plan.payload[0x430..0x530];
        assert_eq!(states.iter().filter(|&&b| b != 0).count(), 13);
    }

    #[test]
    fn erasing_a_tag_with_no_ndef_tlv_is_refused_rather_than_formatted() {
        // Unformatted user memory is not a Tag whose content can be cleared:
        // writing an empty TLV there would be a format, which erase must not be.
        let image = image_with_user_area(&[0u8; RECORDED_USER_BYTES]);
        assert_eq!(
            plan_erase(&recorded_token(), &image, DEFAULT_TAG_SELECTOR),
            Err(PlanError::NothingToErase)
        );
        // And a terminator with no NDEF TLV before it is the same fact.
        let image = image_with_user_area(&parse_hex("FE 00 00 00").unwrap());
        assert_eq!(
            plan_erase(&recorded_token(), &image, DEFAULT_TAG_SELECTOR),
            Err(PlanError::NothingToErase)
        );
    }

    #[test]
    fn erasing_a_tag_that_already_holds_an_empty_tlv_is_refused() {
        // The spike's factory-blank page 4 was `03 00 FE 00`: a Tag with nothing
        // to lose. Rewriting the same bytes buys nothing on a Tag whose writes
        // are one-way risks.
        let image = image_with_user_area(&parse_hex("03 00 FE 00").unwrap());
        assert_eq!(
            plan_erase(&recorded_token(), &image, DEFAULT_TAG_SELECTOR),
            Err(PlanError::AlreadyErased)
        );
    }

    #[test]
    fn erasing_a_tag_whose_message_cannot_be_parsed_is_refused() {
        // A long-form length that runs past the 496 bytes of user memory: the
        // TLV cannot be read, so where the old message ends is unknown. An erase
        // that guessed could leave the tail readable behind a new terminator.
        let image = image_with_user_area(&parse_hex("03 FF 02 00").unwrap());
        match plan_erase(&recorded_token(), &image, DEFAULT_TAG_SELECTOR) {
            Err(PlanError::ContentUnreadable { reason }) => {
                assert!(reason.contains("512"), "{reason}")
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn erasing_a_tag_without_a_capability_container_is_refused() {
        let mut payload = recorded_read_payload();
        let at = 4 + CC_PAGE * PAGE_LEN;
        payload[at..at + PAGE_LEN].copy_from_slice(&[0x00; 4]);
        let image = MemoryImage::from_read_payload(&payload).expect("decode");
        assert_eq!(
            plan_erase(&recorded_token(), &image, DEFAULT_TAG_SELECTOR),
            Err(PlanError::CapacityUnknown)
        );
    }

    #[test]
    fn a_readback_with_an_empty_tlv_and_an_intact_container_is_an_erase() {
        let before = recorded_image();
        let after = image_with_user_area(&parse_hex("03 00 FE 00").unwrap());
        let facts = judge_erase_readback(&before, &after);
        assert!(facts.content_cleared);
        assert!(facts.identity_intact, "pages 0..3 are byte identical");
        assert!(facts.is_erased());
        assert_eq!(
            classify_erase(JudgedEvidence::Readback(Some(facts.is_erased()))),
            WriteOutcome::Erased,
            "success is 'erased', never 'verified'"
        );
    }

    #[test]
    fn a_readback_that_still_holds_the_message_is_a_failed_erase_on_a_readable_tag() {
        // Criterion: a failed erase reports failure and leaves the Tag readable.
        let before = recorded_image();
        let facts = judge_erase_readback(&before, &before);
        assert!(!facts.content_cleared);
        assert!(facts.identity_intact);
        assert!(!facts.is_erased());
        assert_eq!(
            classify_erase(JudgedEvidence::Readback(Some(facts.is_erased()))),
            WriteOutcome::Failed
        );
        // The Tag is still a reading: a UID, a capacity, and the message it kept.
        let view = TagView::from_read(&TagRead {
            info: NtagInfo::from_payload(&ready_info_payload()).expect("ready info"),
            memory: before,
        });
        assert_eq!(view.uid, RECORDED_UID);
        assert_eq!(view.capacity_bytes, Some(496));
        assert_eq!(view.existing.state, "message");
        assert_eq!(view.existing.bytes, 17);
    }

    #[test]
    fn an_erased_tag_reads_back_as_present_with_no_records() {
        // The distinction the ticket exists for: an erased Tag is present with an
        // empty NDEF TLV — not Missing (unformatted) and not a Blank Tag.
        let after = image_with_user_area(&parse_hex("03 00 FE 00").unwrap());
        assert_eq!(read_ndef_tlv(&after.user_area()), NdefTlv::Empty);
        let view = TagView::from_read(&TagRead {
            info: NtagInfo::from_payload(&ready_info_payload()).expect("ready info"),
            memory: after,
        });
        assert_eq!(view.uid, RECORDED_UID, "the Tag is still there");
        assert_eq!(view.reported_tag_type, 5);
        assert_eq!(view.capacity_bytes, Some(496), "the format is unchanged");
        assert_eq!(view.existing.state, "empty");
        assert_eq!(view.existing.bytes, 0, "no Records");
        assert_eq!(view.existing.message_hex, None);
    }

    #[test]
    fn a_readback_whose_capability_container_changed_is_not_an_erase() {
        // Erasing must leave the format alone. If page 3 differs, the operation
        // is not reported as a success even if the content happened to clear.
        let before = recorded_image();
        let mut payload = read_payload_with_user_area(&parse_hex("03 00 FE 00").unwrap());
        let at = 4 + CC_PAGE * PAGE_LEN;
        payload[at..at + PAGE_LEN].copy_from_slice(&[0xE1, 0x10, 0x12, 0x00]);
        let after = MemoryImage::from_read_payload(&payload).expect("decode");
        let facts = judge_erase_readback(&before, &after);
        assert!(facts.content_cleared);
        assert!(!facts.identity_intact, "the CC is not what it was");
        assert!(!facts.is_erased());
        assert_eq!(
            classify_erase(JudgedEvidence::Readback(Some(facts.is_erased()))),
            WriteOutcome::Failed
        );
    }

    #[test]
    fn a_readback_that_is_truncated_is_not_an_erase() {
        // Half a TLV is not an empty one: an erase that left `03 11` behind must
        // not be reported as success.
        let before = recorded_image();
        let after = image_with_user_area(&parse_hex("03 11").unwrap());
        let facts = judge_erase_readback(&before, &after);
        assert!(!facts.content_cleared);
        assert!(!facts.is_erased());
    }

    #[test]
    fn a_readback_missing_the_identity_pages_is_not_evidence_of_an_intact_tag() {
        // A reply too short to carry page 0 is not a page 0 that did not change.
        let before = recorded_image();
        let after = MemoryImage::from_read_payload(&[0, 0, 0, 0]).expect("status only");
        let facts = judge_erase_readback(&before, &after);
        assert!(!facts.identity_intact);
        assert!(!facts.is_erased());
    }

    #[test]
    fn erasing_a_tag_that_cannot_be_read_is_refused_before_any_frame_exists() {
        // ADR 0001, applied to a clearing write: no reading, no frame.
        let no_tag = erase_target(Ok(None)).expect_err("nothing latched is a refusal");
        assert_eq!(no_tag, NO_TAG_ERASE_MESSAGE);
        assert!(no_tag.contains("nothing to erase"), "{no_tag}");

        let unreadable = erase_target(Err("the reader did not answer".to_string()))
            .expect_err("an unreadable Tag is a refusal");
        assert!(unreadable.contains("could not be read"), "{unreadable}");
        assert!(unreadable.contains("nothing was erased"), "{unreadable}");

        // A Tag that was read is the only thing an erase proceeds with.
        let read = TagRead {
            info: NtagInfo::from_payload(&ready_info_payload()).expect("ready info"),
            memory: recorded_image(),
        };
        assert!(erase_target(Ok(Some(read))).is_ok());
    }

    #[test]
    fn a_refused_erase_has_no_bytes_to_show() {
        // The refusal is decided before a payload exists, so nothing can have
        // been transmitted: an empty `written_hex` is the evidence of that.
        let report = EraseReport::refused(NO_TAG_ERASE_MESSAGE.to_string());
        assert_eq!(report.outcome, WriteOutcome::Refused);
        assert!(report.written_hex.is_empty());
        assert!(report.erase_pages.is_empty());
        assert!(!report.outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn the_two_0x0083_parsers_are_one() {
        // Tickets 18 and 19 each built a parser for the same reply. There is now
        // one: the status-bearing `parse`, and `from_payload` refusing anything
        // that is not a ready Tag on top of it.
        let payload = ready_info_payload();
        let parsed = NtagInfo::parse(&payload).expect("64 bytes is a reply");
        assert_eq!(parsed.status, INFO_STATUS_READY);
        assert_eq!(parsed.tag_type, 5);
        assert_eq!(parsed.uid, RECORDED_UID);
        assert_eq!(parsed.token, [0xFF; 8]);
        assert_eq!(NtagInfo::from_payload(&payload), Ok(parsed));

        // Status 1 has no Tag to describe, but the read path needs to see the
        // status rather than a parse error, which is why `parse` exists.
        let mut no_tag = payload.clone();
        no_tag[0..4].copy_from_slice(&INFO_STATUS_NONE.to_le_bytes());
        let parsed = NtagInfo::parse(&no_tag).expect("a status is not a parse failure");
        assert_eq!(parsed.status, INFO_STATUS_NONE);
        assert_eq!(
            NtagInfo::from_payload(&no_tag),
            Err(InfoError::Status {
                status: INFO_STATUS_NONE
            }),
            "the dump path still refuses a reply with no Tag"
        );
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

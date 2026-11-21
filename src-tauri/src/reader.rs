//! USB HID transport and frame protocol for the NFC-PM4 reader.
//!
//! Device identity:
//!   VID:PID  0483:4343   Manufacturer CYBDZKJ-BSJ   Product TCC-TSY-TBY
//!
//! Interface 0 is a tiny mass-storage volume holding a `.url` shortcut to the
//! vendor download page. Interface 1 is a vendor HID interface (usage page
//! 0xFF00) with a 64-byte input and 64-byte output report. That HID channel is
//! where all useful traffic happens.
//!
//! Frame layout (64 bytes, zero padded):
//!
//!   [0]      0x55            magic
//!   [1..3]   command         u16 big endian
//!   [3..5]   payload length  u16 big endian
//!   [5..]    payload
//!   [..+2]   checksum        (x ^ 0xFF, x) where x = XOR of payload bytes
//!
//! 64 bytes is the *report* size, not the frame size. A frame longer than 64
//! bytes is a continuous byte stream split across reports, with no header or
//! padding per report; `stream::ReportStream` reassembles it. See
//! docs/PROTOCOL.md, "Multi-report frames".
//!
//! The checksum quirk: the vendor firmware truncates the XOR loop to the low
//! byte of the payload length, so for payloads >= 256 bytes not every byte is
//! covered. That truncation is the protocol, not a bug: a 1328-byte NTAG write
//! checksummed over its whole payload is ignored, while the `len & 0xFF`
//! checksum is accepted. `xor_checksum` and `stream::encode_frame` reproduce it.

use crate::identity::Identity;
use crate::stream::{split_reports, ReportStream};
use crate::write_guard;
use hidapi::{HidApi, HidDevice};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

pub const VID: u16 = 0x0483;
pub const PID: u16 = 0x4343;
pub const REPORT_LEN: usize = 64;
pub const MAGIC: u8 = 0x55;

// ---- command ids ------------------------------------------------------
pub const CMD_WAKE: u16 = 0x0051;
/// Beeper. Confirmed on hardware: chirps once, and as a side effect drives the
/// LED off -> on. Fire-and-forget (no reply is sent), so silence after sending
/// is not a failure.
pub const CMD_BEEP: u16 = 0x0053;
/// LED off. Confirmed on hardware. This is NOT a beep: an earlier build had
/// 0x0055 wired to the beeper, which is why the beep never fired.
pub const CMD_LED_OFF: u16 = 0x0055;
/// Firmware revision. Verified on hardware: an empty payload gets a 17-byte
/// reply of ASCII `H00S07` followed by NUL padding and a trailing `0x01`.
pub const CMD_VERSION: u16 = 0x0054;
pub const CMD_HF_POLL: u16 = 0x0069;
pub const CMD_LF_READ: u16 = 0x0072;
/// LF write. Discovered by probing; see docs/PROTOCOL.md.
pub const CMD_LF_WRITE: u16 = 0x0073;
/// Documented but not yet wrapped in the UI; reachable via the raw console.
#[allow(dead_code)]
pub const CMD_NTAG_INFO: u16 = 0x0083;

/// XOR checksum, returned as the two wire bytes `(x ^ 0xFF, x)`.
///
/// `checksum_len` reproduces the firmware quirk of only xoring the first
/// `len & 0xFF` payload bytes.
pub fn xor_checksum(payload: &[u8], checksum_len: Option<usize>) -> (u8, u8) {
    let n = checksum_len.unwrap_or(payload.len()).min(payload.len());
    let mut x = 0u8;
    for &b in &payload[..n] {
        x ^= b;
    }
    (x ^ 0xFF, x)
}

/// Build a full 64-byte zero-padded frame.
pub fn make_frame(cmd: u16, payload: &[u8]) -> [u8; REPORT_LEN] {
    assert!(payload.len() <= REPORT_LEN - 7, "payload too long for one frame");
    let mut f = [0u8; REPORT_LEN];
    f[0] = MAGIC;
    f[1] = (cmd >> 8) as u8;
    f[2] = (cmd & 0xFF) as u8;
    f[3] = ((payload.len() >> 8) & 0xFF) as u8;
    f[4] = (payload.len() & 0xFF) as u8;
    f[5..5 + payload.len()].copy_from_slice(payload);
    let (c0, c1) = xor_checksum(payload, Some(payload.len() & 0xFF));
    f[5 + payload.len()] = c0;
    f[6 + payload.len()] = c1;
    f
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frame {
    pub cmd: u16,
    pub payload: Vec<u8>,
    /// Checksum verified against the derived XOR rule.
    pub checksum_ok: bool,
}

/// Parse one frame out of a single report's bytes.
///
/// This is the single-report shape parser; it returns `None` if the report is
/// not a frame we understand. A frame that spans reports must go through
/// [`crate::stream::ReportStream`], which is the only thing that knows a length
/// may exceed one report. The `len` clamp here is best-effort and cannot be
/// reported as a truncation, so it is never the right tool for a live stream.
pub fn parse_frame(raw: &[u8]) -> Option<Frame> {
    if raw.len() < 7 || raw[0] != MAGIC {
        return None;
    }
    let cmd = ((raw[1] as u16) << 8) | raw[2] as u16;
    let len = (((raw[3] as u16) << 8) | raw[4] as u16) as usize;
    // Firmware can report a length that runs past a single 64-byte report for
    // multi-packet responses; clamp and mark the frame as best-effort.
    let avail = raw.len().saturating_sub(5);
    let n = len.min(avail);
    let payload = raw[5..5 + n].to_vec();
    let checksum_ok = if len + 2 <= avail {
        let (c0, c1) = xor_checksum(&payload, Some(len & 0xFF));
        raw[5 + n] == c0 && raw[6 + n] == c1
    } else {
        false
    };
    Some(Frame {
        cmd,
        payload,
        checksum_ok,
    })
}

/// Decode the firmware revision out of a `0x0054` reply.
///
/// The payload is a NUL-terminated ASCII string followed by a trailing flag
/// byte, so everything from the first NUL on is ignored. Anything that is not
/// printable ASCII is rejected rather than displayed as a garbage revision.
pub fn parse_version(payload: &[u8]) -> Option<String> {
    let end = payload.iter().position(|&b| b == 0).unwrap_or(payload.len());
    let text = &payload[..end];
    if text.is_empty() || !text.iter().all(|b| (0x20..=0x7E).contains(b)) {
        return None;
    }
    let s = String::from_utf8_lossy(text).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

// ---- parsed results ---------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub vid: u16,
    pub pid: u16,
    pub product: String,
    pub manufacturer: String,
    pub serial: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LfCard {
    /// EM4100 customer/version byte.
    pub customer: u8,
    /// Little-endian 32-bit field as stored on the wire.
    pub data32: u32,
    /// Full 5-byte EM4100 id, customer byte + big-endian data32.
    pub id: String,
    pub facility: u8,
    pub card: u16,
    pub raw: String,
}

impl LfCard {
    /// A reading from a `0x0072` payload, or `None` when the payload carries no
    /// Identity. The decode itself lives in the Identity codec.
    pub fn from_payload(payload: &[u8]) -> Option<Self> {
        let identity = Identity::from_read_payload(payload)?;
        Some(Self::from_identity(identity, payload))
    }

    /// This reading's Identity.
    pub fn identity(&self) -> Identity {
        Identity {
            customer: self.customer,
            data32: self.data32,
        }
    }

    fn from_identity(identity: Identity, payload: &[u8]) -> Self {
        LfCard {
            customer: identity.customer,
            data32: identity.data32,
            id: identity.id(),
            facility: identity.facility(),
            card: identity.card(),
            raw: hex(payload),
        }
    }
}

/// What one guarded write attempt produced, before the read-back is judged.
///
/// The cases are kept apart on purpose: a refusal means no bytes were sent, a
/// failure means the Tag was never written, and `Transmitted(None)` means the
/// Tag may or may not hold the Identity. `write_outcome` turns each into the
/// outcome the user sees, and only a verified read-back counts as a copy.
#[derive(Debug)]
pub enum LfWriteAttempt {
    /// Nothing was transmitted: no Tag could be read in the write position, or
    /// the Tag already presents the Identity being written (ADR 0001).
    Refused(String),
    /// The write command could not be transmitted.
    Failed(String),
    /// The write was transmitted; `None` means the Tag could not be re-read, so
    /// its state is unknown.
    Transmitted(Option<LfCard>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HfCard {
    /// The poll reply's payload, byte for byte.
    ///
    /// Decoding happens in the frontend (`src/lib/hfDecoder.ts`) because every
    /// offset in that reply is an unverified hypothesis: keeping the transport
    /// dumb means the hypothesis lives in one place, is testable without
    /// hardware, and can be corrected by a single table when a real capture
    /// lands. The raw bytes travel with every reading so the UI can always show
    /// them, decoded or not.
    pub payload: Vec<u8>,
}

/// One `0x0069` reply payload, or `None` when nothing was latched.
///
/// Only the validity flag is interpreted here, because "no Tag in the field" is
/// a Reader state and not a decode result: the UI must not report a Tag for a
/// silent poll. Everything else — length, UID, ATQA, SAK — is the frontend
/// decoder's decision, so a reply of an unexpected shape still reaches the UI as
/// raw bytes instead of being swallowed.
///
/// The flag is payload byte 0, i.e. the byte right after the five-byte frame
/// header. Payload byte 1 is a constant `0x01` and means nothing; reading the
/// flag there was a bug that hid every real reading.
pub fn hf_card_from_payload(payload: &[u8]) -> Option<HfCard> {
    if payload.first() != Some(&0x01) {
        return None;
    }
    Some(HfCard {
        payload: payload.to_vec(),
    })
}

// ---- device wrapper ---------------------------------------------------

pub struct Reader {
    dev: HidDevice,
    pub info: DeviceInfo,
    /// Reports accumulate here across reads, because a frame can span several
    /// of them. See `stream::ReportStream`.
    rx: RefCell<ReportStream>,
}

impl Reader {
    /// Discover and open the reader. Returns a helpful error when absent.
    pub fn open() -> Result<Self, String> {
        let api = HidApi::new().map_err(|e| format!("failed to init HID subsystem: {e}"))?;
        let dev = api
            .open(VID, PID)
            .map_err(|e| format!("reader not found ({VID:04x}:{PID:04x}): {e}"))?;

        let info = DeviceInfo {
            vid: VID,
            pid: PID,
            product: dev.get_product_string().ok().flatten().unwrap_or_default(),
            manufacturer: dev
                .get_manufacturer_string()
                .ok()
                .flatten()
                .unwrap_or_default(),
            serial: dev
                .get_serial_number_string()
                .ok()
                .flatten()
                .unwrap_or_default(),
        };
        Ok(Reader {
            dev,
            info,
            rx: RefCell::new(ReportStream::new()),
        })
    }

    /// Write one 64-byte frame. hidapi on macOS expects the report id as the
    /// first byte, which is 0 for this unnumbered report device.
    fn write_frame(&self, frame: &[u8; REPORT_LEN]) -> Result<(), String> {
        self.write_frame_bytes(frame)
    }

    /// Write a frame of any length as consecutive 64-byte reports, zero-padding
    /// only the last one.
    ///
    /// A frame is a continuous byte stream in both directions: the 1328-byte
    /// NTAG write is one 1335-byte frame sent as 21 reports, and the firmware
    /// gives up if they are more than ~64 ms apart, so they go back to back.
    /// Build the bytes with [`crate::stream::encode_frame`].
    fn write_frame_bytes(&self, frame: &[u8]) -> Result<(), String> {
        for report in split_reports(frame) {
            // hidapi on macOS wants the report id as byte 0, which is 0 for
            // this unnumbered report device.
            let mut buf = [0u8; REPORT_LEN + 1];
            buf[1..].copy_from_slice(&report);
            self.dev
                .write(&buf)
                .map_err(|e| format!("USB write failed: {e}"))?;
        }
        Ok(())
    }

    /// Read one whole frame. Reports are accumulated until a frame is complete,
    /// so a response that spans several reports arrives as one frame instead of
    /// being truncated to its first 64 bytes.
    ///
    /// A timeout with a frame still incomplete is an error: a declared length
    /// longer than the bytes that arrived must be reported, never handed on as a
    /// short payload.
    pub fn read_one(&self, timeout_ms: i32) -> Result<Option<Frame>, String> {
        let mut rx = self.rx.borrow_mut();
        if let Some(frame) = rx.next_frame() {
            return Ok(Some(frame));
        }

        let mut buf = [0u8; REPORT_LEN];
        let n = self
            .dev
            .read_timeout(&mut buf, timeout_ms)
            .map_err(|e| format!("USB read failed: {e}"))?;
        if n == 0 {
            // A poll (`timeout_ms == 0`) asks what is here now; an incomplete
            // frame is not a failure, it is just not finished.
            return if timeout_ms == 0 {
                Ok(None)
            } else {
                match rx.take_error() {
                    Some(e) => Err(e.to_string()),
                    None => Ok(None),
                }
            };
        }
        rx.push(&buf[..n]);
        Ok(rx.next_frame())
    }

    /// Send a command and wait for the first reply matching `expect` (or any
    /// reply when `expect` is None).
    pub fn transact(
        &self,
        cmd: u16,
        payload: &[u8],
        expect: Option<u16>,
        timeout_ms: i32,
    ) -> Result<Option<Frame>, String> {
        self.write_frame(&make_frame(cmd, payload))?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms.max(50) as u64);
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return Ok(None);
            }
            match self.read_one(remaining.as_millis().min(500) as i32)? {
                Some(f) => match expect {
                    Some(e) if f.cmd != e => continue,
                    _ => return Ok(Some(f)),
                },
                None => continue,
            }
        }
    }

    /// Firmware revision, e.g. `H00S07`. Bounded like every other operation: a
    /// wedged firmware answers nothing and this returns an error instead of
    /// leaving the caller waiting.
    pub fn version(&self) -> Result<String, String> {
        // A queued reply must never be read as the version.
        self.drain();
        let f = self
            .transact(CMD_VERSION, &[], Some(CMD_VERSION), 1500)?
            .ok_or_else(|| {
                "the reader did not report a firmware revision. Unplug it, plug it back in, \
                 and press Reconnect."
                    .to_string()
            })?;
        parse_version(&f.payload).ok_or_else(|| {
            format!(
                "the reader returned an unreadable firmware revision: {}",
                hex(&f.payload)
            )
        })
    }

    /// Wake/select handshake. The device simply echoes it back.
    pub fn wake(&self) -> Result<(), String> {
        self.transact(CMD_WAKE, &[0x01], Some(CMD_WAKE), 1500)?;
        Ok(())
    }

    /// Beeper. Fire-and-forget: the firmware does NOT acknowledge 0x0053, but it
    /// audibly chirps. Only one frame is sent and no reply is awaited, which is
    /// why a missing ack must not be treated as a failure.
    pub fn beep(&self) -> Result<(), String> {
        // Drop queued frames first so a stale reply is never mistaken for an ack.
        self.drain();
        self.write_raw(&make_frame(CMD_BEEP, &[]))?;
        Ok(())
    }

    /// Turn the status LED off.
    pub fn led_off(&self) -> Result<(), String> {
        self.drain();
        self.write_raw(&make_frame(CMD_LED_OFF, &[]))?;
        Ok(())
    }

    /// 125 kHz read. One poll attempt; `None` means no tag latched.
    pub fn lf_read_once(&self) -> Result<Option<LfCard>, String> {
        let f = match self.transact(CMD_LF_READ, &[0x00, 0x01], Some(CMD_LF_READ), 1500)? {
            Some(f) => f,
            None => return Ok(None),
        };
        Ok(LfCard::from_payload(&f.payload))
    }

    /// Write an Identity onto a 125 kHz Tag with command `0x0073`.
    ///
    /// The payload comes from the Identity codec, which owns the write layout
    /// and refuses an Identity it cannot encode. This method only transmits it,
    /// and it transmits nothing when the codec refuses.
    pub fn lf_write(&self, identity: Identity) -> Result<(), String> {
        // Fixed-size array: the compiler, not a runtime check, keeps this 24
        // bytes. A shorter payload wedges the firmware until it is replugged.
        let payload = identity.write_payload().map_err(|e| e.to_string())?;
        self.write_raw(&make_frame(CMD_LF_WRITE, &payload))?;
        // The firmware emits a burst of acknowledgement frames after a write.
        std::thread::sleep(std::time::Duration::from_millis(600));
        self.drain();
        Ok(())
    }

    /// Read the tag currently in the write position, retrying briefly because a
    /// tag that was just placed needs a moment to be seen.
    fn read_tag_in_position(&self) -> Result<Option<LfCard>, String> {
        for attempt in 0..10 {
            if attempt > 0 {
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            self.wake().ok();
            if let Some(c) = self.lf_read_once()? {
                return Ok(Some(c));
            }
        }
        Ok(None)
    }

    /// Wake, write, then read the tag back so callers can verify the result.
    ///
    /// The decision to write at all is `write_guard`'s, and it fails closed on
    /// the two conditions in ADR 0001: nothing readable in the write position,
    /// or a tag that already presents the Identity being written. This method
    /// performs the exchange only after the guard allows it.
    pub fn lf_write_verified(&self, identity: Identity) -> Result<Option<LfCard>, String> {
        match self.lf_write_attempt(identity) {
            LfWriteAttempt::Refused(message) | LfWriteAttempt::Failed(message) => Err(message),
            LfWriteAttempt::Transmitted(card) => Ok(card),
        }
    }

    /// One guarded write, reported as what actually happened rather than as a
    /// single boolean.
    ///
    /// A refusal, a transmission failure, and a transmitted write whose
    /// read-back reported nothing are three different facts, and the library
    /// counts a copy for none of them. Keeping them apart is what stops
    /// "unknown" from being recorded as either success or failure.
    pub fn lf_write_attempt(&self, identity: Identity) -> LfWriteAttempt {
        let current = match self.read_tag_in_position() {
            Ok(current) => current,
            // No reading means the guard cannot be satisfied: nothing is sent.
            Err(e) => return LfWriteAttempt::Refused(e),
        };
        let decision = write_guard::decide(current.as_ref().map(LfCard::identity), identity);
        if let Some(refusal) = decision.refusal_message(current.as_ref().map(LfCard::identity)) {
            return LfWriteAttempt::Refused(refusal);
        }

        if let Err(e) = self.lf_write(identity) {
            return LfWriteAttempt::Failed(e);
        }
        for _ in 0..8 {
            self.wake().ok();
            match self.lf_read_once() {
                Ok(Some(card)) => return LfWriteAttempt::Transmitted(Some(card)),
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(250)),
                // The write already went out, so a failing read leaves the Tag
                // in an unknown state rather than unwritten.
                Err(_) => break,
            }
        }
        LfWriteAttempt::Transmitted(None)
    }

    /// 13.56 MHz ISO14443-A poll.
    ///
    /// Returns the payload undecoded; see `hf_card_from_payload`.
    pub fn hf_poll_once(&self) -> Result<Option<HfCard>, String> {
        let f = match self.transact(CMD_HF_POLL, &[], Some(CMD_HF_POLL), 1500)? {
            Some(f) => f,
            None => return Ok(None),
        };
        Ok(hf_card_from_payload(&f.payload))
    }

    /// Discard any queued input frames. The LF read emits two responses per
    /// poll, so a leftover frame otherwise gets misread as the reply to the
    /// next command.
    ///
    /// Partial frames go too: a half frame left behind would otherwise be
    /// spliced onto the next reply, and it was abandoned by its sender anyway.
    pub fn drain(&self) -> usize {
        self.rx.borrow_mut().clear();
        let mut n = 0;
        let mut buf = [0u8; REPORT_LEN];
        while let Ok(k) = self.dev.read_timeout(&mut buf, 0) {
            if k == 0 {
                break;
            }
            n += 1;
            if n >= 32 {
                break;
            }
        }
        n
    }

    /// Send one frame without reading a reply.
    pub fn write_raw(&self, frame: &[u8; REPORT_LEN]) -> Result<(), String> {
        self.write_frame(frame)
    }

    /// Raw escape hatch: send arbitrary bytes as one frame, return the reply.
    pub fn raw_command(&self, frame: &[u8; REPORT_LEN]) -> Result<Option<Frame>, String> {
        self.write_frame(frame)?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(1500);
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                return Ok(None);
            }
            if let Some(f) = self.read_one(remaining.as_millis().min(500) as i32)? {
                return Ok(Some(f));
            }
        }
    }
}

pub fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Parse a hex string ("55 00 51 ...") into raw bytes.
pub fn parse_hex(s: &str) -> Result<Vec<u8>, String> {
    let cleaned: String = s
        .chars()
        .filter(|c| !c.is_whitespace() && *c != ',' && *c != ':' && *c != '-')
        .collect();
    if cleaned.len() % 2 != 0 {
        return Err("hex string must have an even number of digits".into());
    }
    let mut out = Vec::with_capacity(cleaned.len() / 2);
    let b = cleaned.as_bytes();
    let mut i = 0;
    while i < b.len() {
        let pair = std::str::from_utf8(&b[i..i + 2]).map_err(|_| "invalid hex")?;
        let v = u8::from_str_radix(pair, 16).map_err(|_| format!("invalid hex byte: {pair}"))?;
        out.push(v);
        i += 2;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::{Identity, IdentityError, LF_WRITE_PAYLOAD_LEN, MAX_DATA32};
    use crate::test_frames;

    #[test]
    fn checksum_matches_known_frames() {
        // wake: 55 00 51 00 01 01 FE 01
        let (c0, c1) = xor_checksum(&[0x01], None);
        assert_eq!((c0, c1), (0xFE, 0x01));
        // lf read: 55 00 72 00 02 00 01 FE 01
        let (c0, c1) = xor_checksum(&[0x00, 0x01], None);
        assert_eq!((c0, c1), (0xFE, 0x01));
        // hf poll: 55 00 69 00 00 FF 00
        let (c0, c1) = xor_checksum(&[], None);
        assert_eq!((c0, c1), (0xFF, 0x00));
    }

    #[test]
    fn frame_layout_matches_capture() {
        let f = make_frame(CMD_LF_READ, &[0x00, 0x01]);
        assert_eq!(&f[..9], &[0x55, 0x00, 0x72, 0x00, 0x02, 0x00, 0x01, 0xFE, 0x01]);
    }

    #[test]
    fn parses_em4100_lf_response() {
        let raw = parse_hex(test_frames::LF_READ_CARD_PRESENT).unwrap();
        let f = parse_frame(&raw).unwrap();
        assert!(f.checksum_ok);
        let p = &f.payload;
        assert_eq!(p[2], 0x01);
        assert_eq!(p[8], 0x56);
        assert_eq!(u32::from_le_bytes([p[12], p[13], p[14], p[15]]), 0x0053_C7B3);
    }

    #[test]
    fn version_frame_matches_capture() {
        let f = make_frame(CMD_VERSION, &[]);
        assert_eq!(
            &f[..7],
            &[0x55, 0x00, 0x54, 0x00, 0x00, 0xFF, 0x00],
            "captured 0x0054 frame is 55 00 54 00 00 FF 00"
        );
    }

    #[test]
    fn parses_captured_firmware_revision() {
        // Real reply from the reader: cmd 0x0054, 17-byte payload, checksum ok.
        let payload = parse_hex("48 30 30 53 30 37 00 00 00 00 00 00 00 00 00 00 01").unwrap();
        assert_eq!(parse_version(&payload).as_deref(), Some("H00S07"));
    }

    #[test]
    fn rejects_unreadable_version_payloads() {
        assert_eq!(parse_version(&[]), None);
        assert_eq!(parse_version(&[0x00, 0x00, 0x00, 0x00]), None);
        assert_eq!(parse_version(&[0x01, 0x02, 0x03]), None);
        assert_eq!(parse_version(&[0x20, 0x20]), None);
    }

    // ---- 13.56 MHz poll -------------------------------------------------
    //
    // There are no HF captures: every one of these payloads is synthetic, built
    // to the layout hypothesis in src/lib/hfDecoder.ts. They pin the transport
    // boundary only — which byte is the validity flag, and that nothing else is
    // decoded here. Whether the hypothesis matches a real Tag is ticket 12.

    /// 19-byte poll reply: flag 0x01, constant 0x01, UID `DE AD BE EF`,
    /// ATQA 0x0004 at 14..16, SAK 0x08 at 17.
    #[rustfmt::skip]
    const HF_REPLY_LATCHED: [u8; 19] = [
        0x01, 0x01,
        0xDE, 0xAD, 0xBE, 0xEF,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x04, 0x00,
        0x00,
        0x08,
        0x00,
    ];

    #[test]
    fn a_latched_hf_reply_is_a_reading_with_its_raw_bytes() {
        let card = hf_card_from_payload(&HF_REPLY_LATCHED).expect("flag set means latched");
        assert_eq!(card.payload, HF_REPLY_LATCHED);
    }

    #[test]
    fn the_hf_validity_flag_is_payload_byte_zero() {
        // Flag clear at byte 0, constant 0x01 still at byte 1: nothing latched.
        let mut no_tag = HF_REPLY_LATCHED;
        no_tag[0] = 0x00;
        assert!(hf_card_from_payload(&no_tag).is_none());

        // A reply whose byte 1 is 0x00 and byte 0 is 0x01 is still a reading:
        // byte 1 is a constant, not the flag, and must never gate the read.
        let mut odd = HF_REPLY_LATCHED;
        odd[1] = 0x00;
        assert!(hf_card_from_payload(&odd).is_some());
    }

    #[test]
    fn an_empty_hf_reply_is_not_a_reading() {
        assert!(hf_card_from_payload(&[]).is_none());
    }

    #[test]
    fn an_unexpectedly_shaped_hf_reply_still_reaches_the_ui() {
        // The frontend decoder is what reports a length mismatch; the transport
        // must not decide the reply is worthless and hide the bytes.
        let short = vec![0x01, 0x01, 0xDE, 0xAD];
        assert!(hf_card_from_payload(&short).is_some());
        let mut long = HF_REPLY_LATCHED.to_vec();
        long.extend_from_slice(&[0x00; 5]);
        assert!(hf_card_from_payload(&long).is_some());
    }

    #[test]
    fn parses_live_no_card_response() {
        let raw = parse_hex(test_frames::LF_READ_NO_CARD).unwrap();
        let f = parse_frame(&raw).unwrap();
        assert!(f.checksum_ok);
        assert_eq!(f.payload[2], 0x00, "validity flag clear means no tag");
    }

    #[test]
    fn a_stored_read_capture_reports_the_same_values_as_before() {
        let payload = test_frames::payload(test_frames::LF_READ_CARD_PRESENT);
        let card = LfCard::from_payload(&payload).expect("a latched tag is a reading");
        assert_eq!(card.customer, 0x56);
        assert_eq!(card.data32, 0x0053_C7B3);
        assert_eq!(card.id, "56 00 53 C7 B3");
        assert_eq!(card.facility, 0x53);
        assert_eq!(card.card, 0xC7B3);
        assert_eq!(card.raw, hex(&payload), "raw is the payload as captured");
    }

    #[test]
    fn a_stored_no_card_capture_reports_no_reading() {
        let payload = test_frames::payload(test_frames::LF_READ_NO_CARD);
        assert!(LfCard::from_payload(&payload).is_none());
    }

    #[test]
    fn the_clone_path_sends_the_payload_the_device_accepted() {
        // The read-back of a written tag, encoded for writing again, must be
        // byte-identical to the frame the device accepted in docs/PROTOCOL.md.
        let identity = LfCard::from_payload(&test_frames::payload(test_frames::LF_WRITE_READBACK))
            .expect("read-back is a reading")
            .identity();
        let frame = make_frame(CMD_LF_WRITE, &identity.write_payload().expect("in range"));
        let captured = parse_hex(test_frames::LF_WRITE_CONFIRMED).unwrap();
        assert_eq!(&frame[..captured.len()], &captured[..], "frame matches capture");
        assert_eq!(frame[3..5], [0x00, 0x18], "declared payload length is 24");
        assert_eq!(payload_len(&frame), LF_WRITE_PAYLOAD_LEN);
    }

    #[test]
    fn the_clone_path_refuses_an_identity_it_cannot_encode() {
        // The encoder's refusal must reach the caller before anything is sent.
        let identity = Identity {
            customer: 0x55,
            data32: 0x0100_0000,
        };
        assert_eq!(
            identity.write_payload(),
            Err(IdentityError::Data32OutOfRange {
                data32: 0x0100_0000,
                max: MAX_DATA32,
            })
        );
    }

    fn payload_len(frame: &[u8; REPORT_LEN]) -> usize {
        (((frame[3] as usize) << 8) | frame[4] as usize).min(REPORT_LEN - 7)
    }
}

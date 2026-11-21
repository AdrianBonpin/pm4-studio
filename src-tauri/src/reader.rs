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
//! The checksum quirk: the vendor firmware truncates the XOR loop to the low
//! byte of the payload length, so for payloads >= 256 bytes not every byte is
//! covered. For every command this app sends the payload is far below that, so
//! a plain XOR is exact.

use hidapi::{HidApi, HidDevice};
use serde::{Deserialize, Serialize};

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

/// Parse one frame out of a raw report. Returns `None` if the report is not a
/// frame we understand.
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HfCard {
    pub uid: String,
    /// Full payload so nothing is hidden while ATQA/SAK offsets are confirmed.
    pub raw: String,
}

// ---- device wrapper ---------------------------------------------------

pub struct Reader {
    dev: HidDevice,
    pub info: DeviceInfo,
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
        Ok(Reader { dev, info })
    }

    /// Write one 64-byte frame. hidapi on macOS expects the report id as the
    /// first byte, which is 0 for this unnumbered report device.
    fn write_frame(&self, frame: &[u8; REPORT_LEN]) -> Result<(), String> {
        let mut buf = [0u8; REPORT_LEN + 1];
        buf[1..].copy_from_slice(frame);
        match self.dev.write(&buf) {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("USB write failed: {e}")),
        }
    }

    pub fn read_one(&self, timeout_ms: i32) -> Result<Option<Frame>, String> {
        let mut buf = [0u8; REPORT_LEN];
        let n = self
            .dev
            .read_timeout(&mut buf, timeout_ms)
            .map_err(|e| format!("USB read failed: {e}"))?;
        if n == 0 {
            return Ok(None);
        }
        Ok(parse_frame(&buf[..n]))
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

    /// 125 kHz read. One poll attempt; `None` means no badge latched.
    pub fn lf_read_once(&self) -> Result<Option<LfCard>, String> {
        let f = match self.transact(CMD_LF_READ, &[0x00, 0x01], Some(CMD_LF_READ), 1500)? {
            Some(f) => f,
            None => return Ok(None),
        };
        let p = &f.payload;
        // 24-byte payload, validity flag at payload[2], customer byte at
        // payload[8], data32 little endian at payload[12..16].
        if p.len() < 0x18 || p[2] != 0x01 {
            return Ok(None);
        }
        let customer = p[8];
        let data32 = u32::from_le_bytes([p[12], p[13], p[14], p[15]]);
        if data32 == 0 {
            return Ok(None);
        }
        let be = data32.to_be_bytes();
        let id = format!(
            "{:02X} {:02X} {:02X} {:02X} {:02X}",
            customer, be[0], be[1], be[2], be[3]
        );
        Ok(Some(LfCard {
            customer,
            data32,
            id,
            facility: ((data32 >> 16) & 0xFF) as u8,
            card: (data32 & 0xFFFF) as u16,
            raw: hex(&f.payload),
        }))
    }

    /// Write an EM4100 identity onto a blank 125 kHz tag.
    ///
    /// Command 0x0073 with a 24-byte payload. The write layout is shifted +4
    /// relative to the read layout (see docs/PROTOCOL.md):
    ///   [1] = 0x01, [2] = 0x01   enable flags, required
    ///   [8]  = customer byte
    ///   [12] = customer byte
    ///   [16..20] = data32, little endian
    ///
    /// A shorter payload wedges the firmware (stop responding to HID reports
    /// until the reader is replugged), so the length must stay 24.
    pub fn lf_write(&self, customer: u8, data32: u32) -> Result<(), String> {
        let le = data32.to_le_bytes();
        let mut p = [0u8; 24];
        p[1] = 0x01;
        p[2] = 0x01;
        p[8] = customer;
        p[12] = customer;
        p[16..20].copy_from_slice(&le);

        self.write_raw(&make_frame(CMD_LF_WRITE, &p))?;
        // The firmware emits a burst of acknowledgement frames after a write.
        std::thread::sleep(std::time::Duration::from_millis(600));
        self.drain();
        Ok(())
    }

    /// Wake, write, then read the tag back so callers can verify the result.
    ///
    /// Fails closed on two conditions:
    ///  1. The tag on the reader cannot be read at all. We refuse to write blind,
    ///     because we would not know whether we were about to overwrite the
    ///     user's original badge.
    ///  2. The tag already reads as the id being written — that is almost
    ///     certainly the ORIGINAL badge left in place, and writing to it has
    ///     been observed to lock a T5577 permanently.
    pub fn lf_write_verified(&self, customer: u8, data32: u32) -> Result<Option<LfCard>, String> {
        let mut current: Option<LfCard> = None;
        for attempt in 0..10 {
            if attempt > 0 {
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
            self.wake().ok();
            if let Some(c) = self.lf_read_once()? {
                current = Some(c);
                break;
            }
        }
        let current = current.ok_or_else(|| {
            "could not read the tag on the reader, so refusing to write blind. \
             Put a blank 125 kHz tag on the reader and try again."
                .to_string()
        })?;

        if current.customer == customer && current.data32 == data32 {
            return Err(format!(
                "the tag on the reader already reads as {} — that looks like the original \
                 badge. Take it off and put a blank tag on instead.",
                current.id
            ));
        }

        self.lf_write(customer, data32)?;
        for _ in 0..8 {
            self.wake().ok();
            if let Some(c) = self.lf_read_once()? {
                return Ok(Some(c));
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        Ok(None)
    }

    /// 13.56 MHz ISO14443-A poll.
    pub fn hf_poll_once(&self) -> Result<Option<HfCard>, String> {
        let f = match self.transact(CMD_HF_POLL, &[], Some(CMD_HF_POLL), 1500)? {
            Some(f) => f,
            None => return Ok(None),
        };
        let p = &f.payload;
        if p.len() < 6 || p[0] != 0x01 {
            return Ok(None);
        }
        let uid = &p[2..6];
        if uid.iter().all(|&b| b == 0) {
            return Ok(None);
        }
        Ok(Some(HfCard {
            uid: uid
                .iter()
                .map(|b| format!("{b:02X}"))
                .collect::<Vec<_>>()
                .join(" "),
            raw: hex(&f.payload),
        }))
    }

    /// Discard any queued input frames. The LF read emits two responses per
    /// poll, so a leftover frame otherwise gets misread as the reply to the
    /// next command.
    pub fn drain(&self) -> usize {
        let mut n = 0;
        while let Ok(Some(_)) = self.read_one(0) {
            n += 1;
            if n > 32 {
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
        self.read_one(1500)
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
        // Real frame captured from hardware (valid card).
        let raw = parse_hex(
            "55 00 72 00 18 00 01 01 00 00 00 00 00 56 00 00 00 b3 c7 53 00 00 00 c8 42 00 00 00 00 04 fb",
        )
        .unwrap();
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

    #[test]
    fn parses_live_no_card_response() {
        // Real frame captured from the user's reader with no badge present.
        let raw = parse_hex(
            "55 00 72 00 18 00 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 C8 42 00 00 00 00 74 8B",
        )
        .unwrap();
        let f = parse_frame(&raw).unwrap();
        assert!(f.checksum_ok);
        assert_eq!(f.payload[2], 0x00, "validity flag clear means no card");
    }
}

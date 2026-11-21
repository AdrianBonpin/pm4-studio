//! The NTAG read exchange: `0x0083` info, then `0x0081` memory read.
//!
//! Both shapes come straight from docs/PROTOCOL.md, where they are VERIFIED
//! against hardware, and from the merged spike probe
//! (`examples/ntagspike.rs`) that produced that record:
//!
//! ```text
//! OUT  55 00 83 00 06 01 01 00 00 00 00 FF 00
//! OUT  55 00 81 00 10 FF FF FF FF FF FF FF FF 05 00 00 00 00 00 00 00 <cksum>
//! ```
//!
//! The info reply carries the tag type, the 7-byte UID and the 8-byte read
//! token. The read reply is 1284 payload bytes across 21 USB reports — the
//! reassembly is `stream::ReportStream`'s, reached through `Reader::read_one`,
//! so nothing here reads reports or waits on a declared length itself.
//!
//! Read-only: this module sends `0x0083` and `0x0081` and nothing else. There is
//! no erase, no format, no page write.

use crate::memory_dump::TagIdentity;
use crate::reader::{hex, Reader};

/// Tag info. Verified: status 4 = tag ready.
pub const CMD_NTAG_INFO: u16 = 0x0083;
/// Memory read. Verified: replies with the page dump.
pub const CMD_NTAG_READ: u16 = 0x0081;
/// Per-page progress frame emitted while a read runs, before the final dump.
pub const CMD_NTAG_PAGE: u16 = 0x0085;

/// The info reply is 64 payload bytes, whatever it says.
pub const INFO_PAYLOAD_LEN: usize = 0x40;

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
const INFO_TIMEOUT_MS: i32 = 5_500;
/// How long the Reader is given to finish a memory read. The verified read
/// arrives as 21 reports, so this is generous but finite: a silent Reader
/// fails instead of leaving the page waiting.
const READ_TIMEOUT_MS: i32 = 8_000;

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
                 {INFO_PAYLOAD_LEN} the memory read needs"
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
        if payload.len() < INFO_PAYLOAD_LEN {
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
            INFO_TIMEOUT_MS,
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
            READ_TIMEOUT_MS,
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
mod tests {
    use super::*;
    use crate::memory_dump::NTAG_READ_PAYLOAD_LEN;
    use crate::stream::{encode_frame, split_reports, ReportStream};

    const RECORDED_UID: &str = "04 43 8A 01 22 09 03";

    /// A 64-byte info reply built to the verified layout: status 4, tag type 5,
    /// the poll's UID at 0x2A and the read token at 0x38.
    fn ready_info_payload() -> Vec<u8> {
        let mut payload = vec![0u8; INFO_PAYLOAD_LEN];
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
        let short = vec![0u8; INFO_PAYLOAD_LEN - 1];
        assert_eq!(
            NtagInfo::from_payload(&short),
            Err(InfoError::WrongLength {
                got: INFO_PAYLOAD_LEN - 1
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

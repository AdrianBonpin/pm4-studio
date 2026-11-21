//! The 125 kHz Identity codec: pure functions between an Identity and the two
//! wire layouts that carry it.
//!
//! Nothing here touches the device. The read layout and the write layout differ
//! by a four-byte shift (docs/PROTOCOL.md), and that shift plus the endianness
//! and field arithmetic are what this module exists to pin down.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Identity {
    /// EM4100 customer/version byte.
    pub customer: u8,
    /// The 32-bit data field exactly as the wire carries it, little endian.
    pub data32: u32,
}

impl Identity {
    /// An Identity from the values the UI holds. Out-of-range values are
    /// rejected here, so an Identity this app cannot encode never exists.
    ///
    /// Readings taken from a Tag are exempt: `from_read_payload` reports what
    /// the Tag holds, including values this encoder will refuse to write back.
    pub fn new(customer: u8, data32: u32) -> Result<Self, IdentityError> {
        let identity = Identity { customer, data32 };
        identity.check_range()?;
        Ok(identity)
    }

    fn check_range(&self) -> Result<(), IdentityError> {
        if self.data32 > MAX_DATA32 {
            return Err(IdentityError::Data32OutOfRange {
                data32: self.data32,
                max: MAX_DATA32,
            });
        }
        Ok(())
    }

    /// Facility code: the byte above the card number within the data field.
    pub fn facility(&self) -> u8 {
        ((self.data32 >> 16) & 0xFF) as u8
    }

    /// Card number: the low two bytes of the data field.
    pub fn card(&self) -> u16 {
        (self.data32 & 0xFFFF) as u16
    }

    /// The five-byte EM4100 id as it is shown to the user:
    /// `customer`, then the data field big endian.
    pub fn id(&self) -> String {
        let be = self.data32.to_be_bytes();
        format!(
            "{:02X} {:02X} {:02X} {:02X} {:02X}",
            self.customer, be[0], be[1], be[2], be[3]
        )
    }

    /// Decode the payload of a `0x0072` reply.
    ///
    /// `None` means there is no Identity to report: no tag latched, a payload
    /// too short to hold the fields, or an all-zero data field (a Tag whose
    /// Identity has been blanked reads back empty).
    pub fn from_read_payload(payload: &[u8]) -> Option<Self> {
        // 24-byte payload: validity flag at [2], customer at [8], data field
        // little endian at [12..16].
        if payload.len() < LF_READ_PAYLOAD_LEN || payload[2] != 0x01 {
            return None;
        }
        let data32 = u32::from_le_bytes([payload[12], payload[13], payload[14], payload[15]]);
        if data32 == 0 {
            return None;
        }
        Some(Identity {
            customer: payload[8],
            data32,
        })
    }

    /// Encode the payload of a `0x0073` write.
    ///
    /// The write layout is shifted four bytes later than the read layout:
    ///   `[1] = [2] = 0x01`  enable flags, required by the firmware
    ///   `[8] = [12] = customer`
    ///   `[16..20]`          data field, little endian
    ///   `[20..24]`          zero
    ///
    /// The payload length is fixed at 24 bytes: a shorter payload wedges the
    /// firmware until the Reader is physically replugged.
    pub fn write_payload(&self) -> Result<[u8; LF_WRITE_PAYLOAD_LEN], IdentityError> {
        self.check_range()?;
        let mut payload = [0u8; LF_WRITE_PAYLOAD_LEN];
        payload[1] = 0x01;
        payload[2] = 0x01;
        payload[8] = self.customer;
        payload[12] = self.customer;
        payload[16..20].copy_from_slice(&self.data32.to_le_bytes());
        Ok(payload)
    }
}

/// Why an Identity could not be encoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityError {
    /// The data field carries bits the facility/card fields cannot represent.
    Data32OutOfRange { data32: u32, max: u32 },
}

impl std::fmt::Display for IdentityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IdentityError::Data32OutOfRange { data32, max } => write!(
                f,
                "data32 0x{data32:08X} is out of range: the facility and card fields \
                 occupy 24 bits, so the data field must be 0x{max:08X} or less"
            ),
        }
    }
}

impl std::error::Error for IdentityError {}

/// Widest data field an Identity may be encoded from. `facility` occupies one
/// byte and `card` two, so the top byte of the 32-bit field is not part of the
/// decoded Identity and must never be written as if it were.
pub const MAX_DATA32: u32 = 0x00FF_FFFF;

/// Length of the `0x0072` read payload.
pub const LF_READ_PAYLOAD_LEN: usize = 0x18;

/// Length of the `0x0073` write payload. Never send fewer bytes.
pub const LF_WRITE_PAYLOAD_LEN: usize = 24;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_frames;

    #[test]
    fn decodes_the_stored_read_capture() {
        let identity =
            Identity::from_read_payload(&test_frames::payload(test_frames::LF_READ_CARD_PRESENT))
                .expect("a latched tag decodes to an Identity");
        assert_eq!(identity.customer, 0x56);
        assert_eq!(identity.data32, 0x0053_C7B3);
        assert_eq!(identity.facility(), 0x53);
        assert_eq!(identity.card(), 0xC7B3);
        assert_eq!(identity.id(), "56 00 53 C7 B3");
    }

    #[test]
    fn decodes_the_stored_write_readback_capture() {
        let identity =
            Identity::from_read_payload(&test_frames::payload(test_frames::LF_WRITE_READBACK))
                .expect("a written tag reads back as an Identity");
        assert_eq!(identity.customer, 0x55);
        assert_eq!(identity.data32, 0x0084_8212);
        assert_eq!(identity.facility(), 132);
        assert_eq!(identity.card(), 33298);
        assert_eq!(identity.id(), "55 00 84 82 12");
    }

    #[test]
    fn stored_no_card_capture_decodes_to_nothing() {
        let payload = test_frames::payload(test_frames::LF_READ_NO_CARD);
        assert_eq!(Identity::from_read_payload(&payload), None);
    }

    #[test]
    fn a_payload_too_short_to_hold_the_fields_decodes_to_nothing() {
        assert_eq!(Identity::from_read_payload(&[]), None);
        assert_eq!(Identity::from_read_payload(&[0x00, 0x01, 0x01]), None);
        assert_eq!(Identity::from_read_payload(&[0u8; 23]), None);
    }

    #[test]
    fn a_zero_data_field_decodes_to_nothing() {
        // Latched validity flag, but no Identity in the data field.
        let mut payload = [0u8; LF_READ_PAYLOAD_LEN];
        payload[2] = 0x01;
        payload[8] = 0x56;
        assert_eq!(Identity::from_read_payload(&payload), None);
    }

    #[test]
    fn encodes_the_confirmed_write_payload_byte_for_byte() {
        // Identity written in the working example recorded in docs/PROTOCOL.md.
        let identity = Identity {
            customer: 0x55,
            data32: 0x0084_8212,
        };
        let payload = identity.write_payload().expect("0x00848212 is in range");
        assert_eq!(
            payload.to_vec(),
            test_frames::payload(test_frames::LF_WRITE_CONFIRMED),
            "encoded payload must match the frame the device accepted"
        );
    }

    #[test]
    fn write_payload_is_exactly_24_bytes() {
        let payload = Identity {
            customer: 0x55,
            data32: 0x0084_8212,
        }
        .write_payload()
        .expect("in range");
        assert_eq!(payload.len(), LF_WRITE_PAYLOAD_LEN);
        assert_eq!(LF_WRITE_PAYLOAD_LEN, 24, "a short payload wedges firmware");
    }

    #[test]
    fn write_payload_shifts_the_read_layout_by_four() {
        let identity = Identity {
            customer: 0x56,
            data32: 0x0053_C7B3,
        };
        let payload = identity.write_payload().expect("in range");
        assert_eq!(&payload[..8], &[0x00, 0x01, 0x01, 0, 0, 0, 0, 0], "enable flags");
        assert_eq!(payload[8], 0x56, "customer at [8]");
        assert_eq!(payload[9..12], [0, 0, 0]);
        assert_eq!(payload[12], 0x56, "customer repeated at [12]");
        assert_eq!(payload[13..16], [0, 0, 0]);
        assert_eq!(&payload[16..20], &[0xB3, 0xC7, 0x53, 0x00], "data32 LE at [16..20]");
        assert_eq!(&payload[20..24], &[0, 0, 0, 0]);
    }

    #[test]
    fn decoding_then_encoding_reproduces_the_captured_write() {
        // A Tag written by this app reads back with the read layout; encoding
        // that Identity must reproduce the write layout byte for byte.
        let identity =
            Identity::from_read_payload(&test_frames::payload(test_frames::LF_WRITE_READBACK))
                .expect("read-back decodes");
        assert_eq!(
            identity.write_payload().expect("in range").to_vec(),
            test_frames::payload(test_frames::LF_WRITE_CONFIRMED)
        );
    }

    #[test]
    fn an_identity_authoring_request_out_of_range_is_rejected() {
        // Values arriving from the UI are checked before an encoder can see
        // them, so an impossible Identity never exists.
        assert_eq!(
            Identity::new(0x55, 0x0100_0000),
            Err(IdentityError::Data32OutOfRange {
                data32: 0x0100_0000,
                max: MAX_DATA32,
            })
        );
        assert_eq!(
            Identity::new(0x55, 0x0084_8212).expect("in range").id(),
            "55 00 84 82 12"
        );
    }

    #[test]
    fn encoding_rejects_a_data_field_wider_than_facility_and_card() {
        // facility is one byte and card is two, so only the low 24 bits of the
        // data field carry meaning. Anything above that is refused, not zeroed.
        let identity = Identity {
            customer: 0x55,
            data32: 0x0100_0000,
        };
        let err = identity
            .write_payload()
            .expect_err("0x01000000 is out of range");
        assert_eq!(
            err,
            IdentityError::Data32OutOfRange {
                data32: 0x0100_0000,
                max: MAX_DATA32,
            }
        );
        let message = err.to_string();
        assert!(message.contains("0x01000000"), "names the rejected value: {message}");
        assert!(message.contains("0x00FFFFFF"), "names the valid range: {message}");
    }

    #[test]
    fn the_widest_in_range_data_field_still_encodes() {
        let identity = Identity {
            customer: 0xFF,
            data32: MAX_DATA32,
        };
        let payload = identity.write_payload().expect("0x00FFFFFF is in range");
        assert_eq!(&payload[16..20], &[0xFF, 0xFF, 0xFF, 0x00]);
    }

    #[test]
    fn a_tag_that_reads_out_of_range_is_still_readable_but_refused_for_writing() {
        // The reserved high byte of the data field is not part of facility or
        // card, so such a Tag must be read (nothing hidden) yet not written as
        // though those bits had been decoded.
        let mut payload = [0u8; LF_READ_PAYLOAD_LEN];
        payload[2] = 0x01;
        payload[8] = 0x56;
        payload[12..16].copy_from_slice(&0x0153_C7B3u32.to_le_bytes());

        let identity = Identity::from_read_payload(&payload).expect("the Tag still reads");
        assert_eq!(identity.facility(), 0x53);
        assert_eq!(identity.card(), 0xC7B3);
        assert!(matches!(
            identity.write_payload(),
            Err(IdentityError::Data32OutOfRange { .. })
        ));
    }
}

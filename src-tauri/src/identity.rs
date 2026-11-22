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
    /// The Identity a **destroyed** Tag carries: no customer byte and no data.
    ///
    /// Writing this is what **Destroy** means, and it is the only thing that
    /// writes it. The read path cannot report it back as an Identity — an
    /// all-zero data field decodes to "no reading" — so a Tag that holds it
    /// reads as carrying no Identity. That asymmetry is why a destroying write
    /// is judged by [`crate::write_outcome::classify_destroy`] rather than by
    /// the copy rule (ADR 0003).
    ///
    /// **Measured, three instances:** a T5577 written with this payload stops
    /// presenting an Identity, keeps latching and modulating so every reader
    /// still reaches it, and permanently refuses further data (two of the three
    /// after a field re-seat). The all-zero payload is not clone-shaped — it is
    /// the one payload this project has written that no clone ever writes — and
    /// zero is what locked the chips. What is a *chip mechanism* rather than a
    /// correlation is recorded in `docs/PROTOCOL.md`, open problem 7.
    pub const BLANK: Identity = Identity {
        customer: 0,
        data32: 0,
    };

    /// The Identity a **cleared** Tag carries: the placeholder **Clear** writes.
    ///
    /// Customer `0x00`, facility `0xFF`, card `0xFFFF`, i.e. data32
    /// `0x00FF_FFFF`. This is the one definition of the value; the interface
    /// shows what the backend reports rather than spelling the number itself.
    ///
    /// # Why this value
    ///
    /// **Not zero.** An all-zero data field is the payload that locks a T5577
    /// (see [`Identity::BLANK`]). A cleared Tag has to stay usable, so it has to
    /// carry a value rather than nothing.
    ///
    /// **Not a small round number.** A cleared Tag is still a token: it keeps
    /// modulating, so every reader still reads a number off it. Card 1 or
    /// facility 1 are numbers a building system plausibly issued, and a cleared
    /// fob that happens to match someone's real credential would open a door.
    /// The placeholder therefore sits at the top of both fields — facility `0xFF`,
    /// card `0xFFFF` — which no system issues, because card numbers are allocated
    /// from 1 upward and facility codes come from a small allocated range.
    ///
    /// **In range for the codec.** `0x00FF_FFFF` is [`MAX_DATA32`], so the value
    /// encodes and reads back as a normal Identity. It does not set the reserved
    /// high byte, so a cleared Tag is not left in the state where a value reads
    /// but cannot be written back as a copy.
    ///
    /// **Non-zero, so the app can see it.** `TagPresence::from_read_payload`
    /// reports an all-zero data field as `Blank`, which is why a destroyed Tag is
    /// indistinguishable from an empty field. A cleared Tag reads as
    /// `Identified`, so it is visible as an object and is a legal write position
    /// for the next Clone or authored Identity.
    ///
    /// # Why the payload shape matters more than the value
    ///
    /// The safety argument is not "non-zero therefore fine". It is that this is
    /// a **clone-shaped** payload: customer at `[8]` and `[12]`, data32 at
    /// `[16..20]`, in the 24-byte layout that `Identity::write_payload` produces
    /// and that this app writes routinely when cloning. Clone writes have never
    /// locked a chip. The all-zero payload is the one payload with a shape no
    /// clone has, and it is the one that locked three chips. That is stronger
    /// than a value argument and still weaker than a hardware confirmation: no
    /// fresh T5577 has been cleared and then written again, because none is left.
    pub const CLEARED: Identity = Identity {
        customer: 0,
        data32: 0x00FF_FFFF,
    };

    /// True when this Identity carries no assigned value: no customer byte and
    /// an empty data field.
    ///
    /// A *reading* is judged blank on its data field alone, because that is what
    /// the codec gates on; see [`TagPresence::from_read_payload`].
    pub fn is_blank(&self) -> bool {
        self.customer == 0 && self.data32 == 0
    }

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

    /// The Identity for a customer byte, a facility code and a card number, as
    /// the authoring form collects them.
    ///
    /// This is the exact inverse of [`Identity::facility`] and [`Identity::card`]
    /// and is defined here, beside them, so the form a user types into and the
    /// decoder that reports a read cannot drift apart: the bit layout is written
    /// once, in this module. Authoring therefore never re-derives it.
    ///
    /// `facility` occupies the byte above the card number and `card` the low two
    /// bytes, so the top byte of the data field is not reachable from these two
    /// values — which is why out-of-range input is rejected here rather than
    /// truncated.
    pub fn from_facility_card(
        customer: u8,
        facility: u8,
        card: u16,
    ) -> Result<Self, IdentityError> {
        Self::new(customer, ((facility as u32) << 16) | card as u32)
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
    ///
    /// This is the combined view: it cannot tell "no Tag" from "a Tag with no
    /// Identity", which is exactly the distinction a blanking write needs. Use
    /// [`TagPresence::from_read_payload`] when that distinction matters.
    pub fn from_read_payload(payload: &[u8]) -> Option<Self> {
        match TagPresence::from_read_payload(payload) {
            TagPresence::Identified(identity) => Some(identity),
            TagPresence::Absent | TagPresence::Unreadable | TagPresence::Blank => None,
        }
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

/// What a `0x0072` read reply says about the Tag in the field.
///
/// The codec's combined decoder ([`Identity::from_read_payload`]) folds three of
/// these into `None`, because the read UI only cares whether there is an
/// Identity to show. A blanking write needs the distinction: a Tag that is
/// present but carries no Identity is exactly what blanking aims to produce, and
/// it must not be confused with an empty field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TagPresence {
    /// No Tag latched: the validity flag is clear.
    Absent,
    /// The reply is too short to hold the fields, so it says nothing at all.
    /// Never read as "absent": a malformed reply is not evidence of an empty
    /// field.
    Unreadable,
    /// A Tag is latched and its data field is empty: it carries no Identity.
    Blank,
    /// A Tag carrying an Identity.
    Identified(Identity),
}

impl TagPresence {
    /// Decode the payload of a `0x0072` reply into presence plus Identity.
    ///
    /// The layout is the read layout: validity flag at `[2]`, customer at `[8]`,
    /// data field little endian at `[12..16]`.
    pub fn from_read_payload(payload: &[u8]) -> Self {
        if payload.len() < LF_READ_PAYLOAD_LEN {
            return TagPresence::Unreadable;
        }
        if payload[2] != 0x01 {
            return TagPresence::Absent;
        }
        let data32 = u32::from_le_bytes([payload[12], payload[13], payload[14], payload[15]]);
        if data32 == 0 {
            return TagPresence::Blank;
        }
        TagPresence::Identified(Identity {
            customer: payload[8],
            data32,
        })
    }

    /// True when a Tag was seen at all, holding an Identity or not.
    ///
    /// A blanking write requires this: the ADR 0001 refusal is about writing
    /// blind, not about the Tag having a value worth replacing.
    pub fn tag_present(self) -> bool {
        matches!(self, TagPresence::Blank | TagPresence::Identified(_))
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
    fn authoring_from_facility_and_card_reproduces_the_decoded_identity() {
        // The authoring form and the decoder share one bit layout: values typed
        // into the form must produce exactly the Identity the decoder reports for
        // the same Tag. Asserted against a hardware capture, not against itself.
        for frame in [test_frames::LF_WRITE_READBACK, test_frames::LF_READ_CARD_PRESENT] {
            let read = Identity::from_read_payload(&test_frames::payload(frame))
                .expect("a captured reading decodes");
            let authored = Identity::from_facility_card(read.customer, read.facility(), read.card())
                .expect("the fields a reading reports are in range");
            assert_eq!(authored, read, "authored Identity must equal the decoded one");
        }

        let authored = Identity::from_facility_card(0x55, 132, 33298).expect("in range");
        assert_eq!(authored.data32, 0x0084_8212);
        assert_eq!(authored.id(), "55 00 84 82 12", "the id the UI shows");
    }

    #[test]
    fn the_widest_facility_and_card_still_author() {
        let identity = Identity::from_facility_card(0xFF, 0xFF, 0xFFFF).expect("in range");
        assert_eq!(identity.data32, MAX_DATA32);
        assert_eq!(identity.facility(), 0xFF);
        assert_eq!(identity.card(), 0xFFFF);
        assert_eq!(&identity.write_payload().expect("in range")[16..20], &[0xFF, 0xFF, 0xFF, 0x00]);
    }

    #[test]
    fn the_id_text_is_the_five_bytes_authoring_accepts_back() {
        let identity = Identity::from_facility_card(0x56, 0x53, 0xC7B3).expect("in range");
        assert_eq!(identity.id(), "56 00 53 C7 B3");
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

    // ---- blankness: presence versus an empty data field --------------------

    // ---- the cleared placeholder -----------------------------------------

    #[test]
    fn the_cleared_placeholder_is_a_real_identity_and_not_a_blank_one() {
        // Clear must leave the Tag carrying a value: the all-zero data field is
        // the payload that locks a T5577, and an all-zero field is also what the
        // presence decoder reports as `Blank` — indistinguishable from an empty
        // field, so the app could not see the Tag at all.
        assert!(!Identity::CLEARED.is_blank());
        assert_ne!(Identity::CLEARED.data32, 0);
        assert_eq!(Identity::CLEARED.customer, 0x00);
        assert_eq!(Identity::CLEARED.facility(), 0xFF);
        assert_eq!(Identity::CLEARED.card(), 0xFFFF);
        assert_eq!(Identity::CLEARED.id(), "00 00 FF FF FF");
    }

    #[test]
    fn the_cleared_placeholder_sits_at_the_top_of_both_fields() {
        // The collision reasoning, pinned: a cleared Tag is still a token, so the
        // placeholder must be a number no building system issues. Card numbers
        // are allocated from 1 upward, so max card and max facility is the least
        // plausible value the two fields can hold. A later edit that picks a
        // small round number — card 1, facility 1 — fails here.
        assert_eq!(Identity::CLEARED.data32, MAX_DATA32);
        assert_eq!(Identity::CLEARED.facility(), u8::MAX);
        assert_eq!(Identity::CLEARED.card(), u16::MAX);
        assert_ne!(Identity::CLEARED.card(), 1);
        assert_ne!(Identity::CLEARED.facility(), 1);
    }

    #[test]
    fn the_cleared_placeholder_is_in_range_and_encodes_shape_for_shape_like_a_clone() {
        // The safety argument is the payload's *shape*: customer at [8] and [12],
        // data32 at [16..20], in the same 24-byte layout every routine clone
        // write uses. Clone writes have never locked a chip.
        let payload = Identity::CLEARED
            .write_payload()
            .expect("the placeholder is in range");
        assert_eq!(payload.len(), LF_WRITE_PAYLOAD_LEN);
        assert_eq!(&payload[..3], &[0x00, 0x01, 0x01], "enable flags");
        assert_eq!(payload[8], 0x00, "customer at [8]");
        assert_eq!(payload[12], 0x00, "customer repeated at [12]");
        assert_eq!(&payload[16..20], &[0xFF, 0xFF, 0xFF, 0x00], "data32 LE at [16..20]");
        assert_eq!(&payload[20..24], &[0, 0, 0, 0]);
        // Clone-shaped and not the destroying payload, in one comparison.
        assert_ne!(payload, Identity::BLANK.write_payload().expect("in range"));
    }

    #[test]
    fn a_cleared_tag_reads_back_as_an_identified_tag_not_as_a_blank_one() {
        // The whole reason the placeholder is non-zero: the app can see a
        // cleared Tag, so it is a legal write position for the next Clone or
        // authored Identity rather than a field that looks empty.
        let mut payload = [0u8; LF_READ_PAYLOAD_LEN];
        payload[2] = 0x01;
        payload[8] = Identity::CLEARED.customer;
        payload[12..16].copy_from_slice(&Identity::CLEARED.data32.to_le_bytes());

        assert_eq!(
            TagPresence::from_read_payload(&payload),
            TagPresence::Identified(Identity::CLEARED)
        );
        assert!(TagPresence::from_read_payload(&payload).tag_present());
        assert_eq!(
            Identity::from_read_payload(&payload),
            Some(Identity::CLEARED)
        );
    }

    #[test]
    fn the_neutral_identity_carries_no_identity() {
        assert!(Identity::BLANK.is_blank());
        assert_eq!(Identity::BLANK.customer, 0);
        assert_eq!(Identity::BLANK.data32, 0);
        assert!(!Identity {
            customer: 0,
            data32: 1
        }
        .is_blank());
        assert!(!Identity {
            customer: 1,
            data32: 0
        }
        .is_blank());
    }

    #[test]
    fn the_neutral_identity_encodes_as_a_neutral_write() {
        // Still a full 24-byte payload with the firmware's enable flags: a short
        // payload wedges the Reader, so "write nothing" is 24 bytes of nothing.
        let payload = Identity::BLANK
            .write_payload()
            .expect("the neutral identity is in range");
        assert_eq!(payload.len(), LF_WRITE_PAYLOAD_LEN);
        assert_eq!(&payload[..3], &[0x00, 0x01, 0x01], "enable flags");
        assert_eq!(&payload[3..], &[0u8; 21], "every other byte is zero");
    }

    #[test]
    fn a_latched_payload_with_an_empty_data_field_reads_as_blank_not_absent() {
        // The design problem this ticket inherited: the combined decoder calls
        // this "no reading", so only the presence-aware decoder can say that a
        // Tag is there and carries no Identity.
        let mut payload = [0u8; LF_READ_PAYLOAD_LEN];
        payload[2] = 0x01;
        payload[8] = 0x00;
        assert_eq!(TagPresence::from_read_payload(&payload), TagPresence::Blank);
        assert!(TagPresence::from_read_payload(&payload).tag_present());
        assert_eq!(Identity::from_read_payload(&payload), None);
    }

    #[test]
    fn a_cleared_validity_flag_is_absent() {
        let payload = test_frames::payload(test_frames::LF_READ_NO_CARD);
        assert_eq!(
            TagPresence::from_read_payload(&payload),
            TagPresence::Absent
        );
        assert!(!TagPresence::from_read_payload(&payload).tag_present());
    }

    #[test]
    fn a_short_reply_is_unreadable_and_never_absent() {
        // A truncated reply is not evidence that the field is empty.
        assert_eq!(TagPresence::from_read_payload(&[]), TagPresence::Unreadable);
        assert_eq!(
            TagPresence::from_read_payload(&[0u8; 23]),
            TagPresence::Unreadable
        );
    }

    #[test]
    fn a_reading_decodes_to_the_same_identity_through_both_decoders() {
        let payload = test_frames::payload(test_frames::LF_READ_CARD_PRESENT);
        let combined = Identity::from_read_payload(&payload).expect("a latched tag decodes");
        assert_eq!(
            TagPresence::from_read_payload(&payload),
            TagPresence::Identified(combined)
        );
    }
}

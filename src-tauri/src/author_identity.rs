//! Authoring an Identity by hand: the two ways a user can type one, the ranges
//! that reject the rest, and the exact value shown before a write is sent.
//!
//! Nothing here touches the Reader. Every rule below is a pure function, so the
//! whole authoring seam — input text to [`Identity`], the range refusals, and
//! the payload the confirmation displays — is provable with no hardware
//! attached.
//!
//! # The codec is not re-derived here
//!
//! The bit layout of an Identity lives in one place,
//! [`crate::identity`]: `facility()` and `card()` read it, and
//! `Identity::from_facility_card` writes it back. This module only turns text
//! into those values, so the form and the decoder cannot disagree about what a
//! facility code means. Tests below assert the round trip against frames
//! captured from real Tags.
//!
//! # Refusals name the range
//!
//! An out-of-range entry is never truncated into range and never reported as a
//! bare "invalid": every error says which field, what was entered, and what the
//! field will hold. The one range a user is most likely to meet by surprise is
//! the data field's: facility and card together occupy 24 bits, so the second
//! of the five hex bytes must be `00`. Typing a nonzero second byte is refused
//! with that explanation rather than written as though those bits had meaning.

use crate::identity::Identity;

/// Which value the user typed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthorField {
    Customer,
    Facility,
    Card,
}

impl AuthorField {
    /// The word the UI and the error messages use for this field.
    pub fn label(self) -> &'static str {
        match self {
            AuthorField::Customer => "customer",
            AuthorField::Facility => "facility",
            AuthorField::Card => "card",
        }
    }

    /// The largest value this field can carry.
    pub fn max(self) -> u32 {
        match self {
            AuthorField::Customer => u8::MAX as u32,
            AuthorField::Facility => u8::MAX as u32,
            AuthorField::Card => u16::MAX as u32,
        }
    }

    /// The valid range, in the digits the field is written with and in hex.
    /// Every refusal quotes this, so a user never has to guess a bound.
    pub fn range_label(self) -> &'static str {
        match self {
            AuthorField::Customer => "0–255 (0x00–0xFF)",
            AuthorField::Facility => "0–255 (0x00–0xFF)",
            AuthorField::Card => "0–65535 (0x0000–0xFFFF)",
        }
    }
}

/// Why a hand-authored Identity was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthorError {
    /// The field is not a number this app reads: decimal digits, or hex with a
    /// `0x` prefix.
    NotANumber {
        field: AuthorField,
        entered: String,
    },
    /// The field is a number, and too large for what the Identity carries.
    OutOfRange {
        field: AuthorField,
        entered: u64,
        max: u32,
    },
    /// The raw entry contains characters that are not hex digits.
    NotHex { entered: String },
    /// The raw entry is not exactly five bytes.
    WrongHexLength { bytes: usize, entered: String },
    /// Five well-formed bytes whose data field is wider than the 24 bits
    /// facility and card occupy.
    DataOutOfRange { data32: u32, max: u32 },
}

impl std::fmt::Display for AuthorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthorError::NotANumber { field, entered } => write!(
                f,
                "{} \"{entered}\" is not a number: enter a decimal value {}, or a hex \
                 value with a 0x prefix",
                field.label(),
                field.range_label()
            ),
            AuthorError::OutOfRange {
                field,
                entered,
                max: _,
            } => write!(
                f,
                "{} {entered} is out of range: the {} field must be {}",
                field.label(),
                field.label(),
                field.range_label()
            ),
            AuthorError::NotHex { entered } => write!(
                f,
                "a raw Identity is five bytes of hex digits — 10 digits, with an optional \
                 0x prefix — so \"{entered}\" is not one. Enter five bytes, for example \
                 55 00 84 82 12"
            ),
            AuthorError::WrongHexLength { bytes, entered } => write!(
                f,
                "a raw Identity is exactly five bytes — {} hex digits, an optional 0x \
                 prefix aside — and \"{entered}\" is {bytes} {}. Enter five bytes, for \
                 example 55 00 84 82 12",
                FIVE_BYTES * 2,
                if *bytes == 1 { "byte" } else { "bytes" }
            ),
            AuthorError::DataOutOfRange { data32, max } => write!(
                f,
                "the data field 0x{data32:08X} is out of range: facility and card occupy 24 \
                 bits, so the data field must be 0x00000000–0x{max:08X}. In five-byte hex that \
                 means the second byte must be 00"
            ),
        }
    }
}

impl std::error::Error for AuthorError {}

impl From<crate::identity::IdentityError> for AuthorError {
    fn from(error: crate::identity::IdentityError) -> Self {
        match error {
            crate::identity::IdentityError::Data32OutOfRange { data32, max } => {
                AuthorError::DataOutOfRange { data32, max }
            }
        }
    }
}

/// Exactly the Identity that will be written, ready to show before the write.
///
/// This is a confirmation payload, not a report: it is produced by the same
/// codec that encodes the write, from the same [`Identity`] the guard will be
/// handed, so what the user reads is what the Reader is asked to write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Preview {
    pub identity: Identity,
    /// The five-byte id as every other surface shows it: `55 00 84 82 12`.
    pub id: String,
    /// The same five bytes with no spaces, for copying.
    pub hex: String,
    /// The 24-byte `0x0073` payload, hex. This is what goes on the wire.
    pub payload_hex: String,
    /// The payload itself, so a test can compare it against a capture.
    pub payload: [u8; crate::identity::LF_WRITE_PAYLOAD_LEN],
}

/// Bytes in an EM4100 Identity as the user writes it: customer plus data field.
pub const FIVE_BYTES: usize = 5;

/// The Identity a customer, facility and card entry describes.
///
/// Each field is decimal digits, or hex with a `0x` prefix. Anything else, and
/// any value the field cannot carry, is refused with the range named.
pub fn from_parts(customer: &str, facility: &str, card: &str) -> Result<Identity, AuthorError> {
    let customer = u8::try_from(parse_field(AuthorField::Customer, customer)?)
        .expect("parse_field keeps the value within the field's maximum");
    let facility = u8::try_from(parse_field(AuthorField::Facility, facility)?)
        .expect("parse_field keeps the value within the field's maximum");
    let card = u16::try_from(parse_field(AuthorField::Card, card)?)
        .expect("parse_field keeps the value within the field's maximum");
    Ok(Identity::from_facility_card(customer, facility, card)?)
}

/// The Identity a raw five-byte hex entry describes.
///
/// The five bytes are the id every other surface shows: the customer byte, then
/// the data field big endian. Separators and an `0x` prefix are accepted, so a
/// value copied from the readout, from a spreadsheet, or typed in one run all
/// mean the same thing.
pub fn from_hex(text: &str) -> Result<Identity, AuthorError> {
    let entered = text.trim();
    let body = entered
        .strip_prefix("0x")
        .or_else(|| entered.strip_prefix("0X"))
        .unwrap_or(entered);
    let compact: String = body
        .chars()
        .filter(|c| !matches!(c, ' ' | '\t' | '\n' | '\r' | ':' | '-' | '_'))
        .collect();

    // Characters first: a stray letter is a typo to name, not a length to
    // complain about. An empty entry has no bad characters, so it falls through
    // to the length refusal, which says how many bytes are needed.
    if !compact.is_empty() && !compact.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AuthorError::NotHex {
            entered: entered.to_string(),
        });
    }
    if compact.len() != FIVE_BYTES * 2 {
        return Err(AuthorError::WrongHexLength {
            bytes: compact.len() / 2,
            entered: entered.to_string(),
        });
    }

    let digit_pairs = compact.as_bytes();
    let mut bytes = [0u8; FIVE_BYTES];
    for (i, byte) in bytes.iter_mut().enumerate() {
        let pair = &compact[i * 2..i * 2 + 2];
        debug_assert_eq!(pair.len(), 2);
        debug_assert!(digit_pairs.len() == FIVE_BYTES * 2);
        *byte = u8::from_str_radix(pair, 16).expect("checked as hex digits above");
    }

    // The id layout, exactly as `Identity::id` prints it: customer, then the
    // data field big endian. The data field is handed to `Identity::new`, which
    // is where the 24-bit limit is enforced.
    let data32 = u32::from_be_bytes([bytes[1], bytes[2], bytes[3], bytes[4]]);
    Ok(Identity::new(bytes[0], data32)?)
}

/// Everything the confirmation shows for one Identity.
///
/// Produced by the same codec that encodes the write, so the value on screen and
/// the value on the wire cannot disagree. Pure: nothing here can reach the
/// Reader, which is what makes the confirmation a step *before* the write rather
/// than a report after it.
pub fn preview(identity: Identity) -> Result<Preview, AuthorError> {
    let payload = identity.write_payload()?;
    Ok(Preview {
        identity,
        id: identity.id(),
        hex: identity.id().replace(' ', ""),
        payload_hex: crate::reader::hex(&payload),
        payload,
    })
}

/// One field's text as the number the Identity carries.
///
/// Decimal unless the text is prefixed `0x`, because `84` and `0x84` are
/// different numbers and guessing which was meant is how a wrong credential gets
/// written. A value that overflows even `u64` saturates: it is out of range, not
/// a different number.
fn parse_field(field: AuthorField, text: &str) -> Result<u32, AuthorError> {
    let entered = text.trim();
    let (radix, digits) = match entered
        .strip_prefix("0x")
        .or_else(|| entered.strip_prefix("0X"))
    {
        Some(rest) => (16u32, rest.trim()),
        None => (10u32, entered),
    };
    if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
        return Err(AuthorError::NotANumber {
            field,
            entered: entered.to_string(),
        });
    }

    let value = digits
        .chars()
        .try_fold(0u64, |acc, c| {
            let digit = u64::from(c.to_digit(radix).expect("checked as a digit above"));
            acc.checked_mul(u64::from(radix))?.checked_add(digit)
        })
        .unwrap_or(u64::MAX);

    if value > u64::from(field.max()) {
        return Err(AuthorError::OutOfRange {
            field,
            entered: value,
            max: field.max(),
        });
    }
    Ok(value as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::MAX_DATA32;
    use crate::test_frames;
    use crate::write_guard::{self, WriteDecision};
    use crate::write_outcome::{self, classify, Evidence, WriteOutcome};

    /// The Identity this app wrote to a real Tag, `55 00 84 82 12`.
    fn written_tag() -> Identity {
        Identity::from_read_payload(&test_frames::payload(test_frames::LF_WRITE_READBACK))
            .expect("read-back capture decodes")
    }

    /// A different real Tag, `56 00 53 C7 B3`.
    fn other_tag() -> Identity {
        Identity::from_read_payload(&test_frames::payload(test_frames::LF_READ_CARD_PRESENT))
            .expect("read capture decodes")
    }

    // ---- the same Identity the decoder reports ---------------------------

    #[test]
    fn parts_produce_the_identity_the_decoder_reports() {
        // Both captured Tags, in both directions: decode the frame the Reader
        // sent, type its fields back in, and require the same Identity.
        for (frame, expected_id) in [
            (test_frames::LF_WRITE_READBACK, "55 00 84 82 12"),
            (test_frames::LF_READ_CARD_PRESENT, "56 00 53 C7 B3"),
        ] {
            let read = Identity::from_read_payload(&test_frames::payload(frame))
                .expect("a captured reading decodes");
            let authored = from_parts(
                &read.customer.to_string(),
                &read.facility().to_string(),
                &read.card().to_string(),
            )
            .expect("the fields a reading reports are in range");
            assert_eq!(authored, read);
            assert_eq!(authored.id(), expected_id);
        }
    }

    #[test]
    fn a_decimal_customer_and_a_hex_customer_are_the_same_identity() {
        // 85 decimal is 0x55: the two spellings of one value must not diverge.
        let decimal = from_parts("85", "132", "33298").expect("in range");
        let hexadecimal = from_parts("0x55", "0x84", "0x8212").expect("in range");
        assert_eq!(decimal, hexadecimal);
        assert_eq!(decimal, written_tag());
        assert_eq!(decimal.id(), "55 00 84 82 12");
    }

    #[test]
    fn the_authored_payload_is_the_payload_the_device_accepted() {
        // Not "an encoding": the exact 24 bytes from the hardware capture, so a
        // layout change in the codec shows up as a diff against the Reader.
        let authored = from_parts("85", "132", "33298").expect("in range");
        let preview = preview(authored).expect("in range");
        assert_eq!(
            preview.payload.to_vec(),
            test_frames::payload(test_frames::LF_WRITE_CONFIRMED)
        );
    }

    #[test]
    fn the_wide_end_of_both_fields_still_authors() {
        let identity = from_parts("255", "255", "65535").expect("in range");
        assert_eq!(identity.data32, MAX_DATA32);
        assert_eq!(identity.facility(), 0xFF);
        assert_eq!(identity.card(), 0xFFFF);
        assert_eq!(identity.id(), "FF 00 FF FF FF");
        assert_eq!(preview(identity).expect("in range").payload.len(), 24);
    }

    // ---- the raw five-byte form -----------------------------------------

    #[test]
    fn the_raw_form_is_five_bytes_and_ten_hex_digits() {
        // The constant the parser and the refusal both quote. A reader of the
        // error message and a reader of this code must count the same bytes.
        assert_eq!(FIVE_BYTES, 5);
        assert_eq!(FIVE_BYTES * 2, 10);
    }

    #[test]
    fn raw_hex_accepts_every_way_a_user_may_write_five_bytes() {
        let expected = written_tag();
        for text in [
            "55 00 84 82 12",
            "55 00 84 82 12 ",
            "  55  00  84  82  12 ",
            "5500848212",
            "0x5500848212",
            "0X5500848212",
            "55:00:84:82:12",
            "55-00-84-82-12",
            "55_00_84_82_12",
            "5500 8482 12",
        ] {
            assert_eq!(from_hex(text).expect(text), expected, "input {text:?}");
        }
    }

    #[test]
    fn raw_hex_accepts_lower_case() {
        assert_eq!(
            from_hex("55 00 84 82 12").expect("in range"),
            from_hex("55 00 84 82 12".to_lowercase().as_str()).expect("in range")
        );
        assert_eq!(
            from_hex("ff 00 aa bb cc").expect("in range").id(),
            "FF 00 AA BB CC"
        );
    }

    #[test]
    fn the_five_byte_form_is_the_id_the_reader_reports() {
        // `id()` and `from_hex` are inverses: the string shown for a read is
        // accepted back as the entry that reproduces it.
        for frame in [
            test_frames::LF_WRITE_READBACK,
            test_frames::LF_READ_CARD_PRESENT,
        ] {
            let read = Identity::from_read_payload(&test_frames::payload(frame))
                .expect("a captured reading decodes");
            assert_eq!(from_hex(&read.id()).expect("its own id"), read);
        }
    }

    #[test]
    fn a_raw_entry_of_the_wrong_length_is_refused_and_says_five_bytes() {
        for (text, bytes) in [
            ("55 00 84", 3),
            ("55 00 84 82", 4),
            ("55 00 84 82 12 01", 6),
            ("", 0),
        ] {
            let error = from_hex(text).expect_err(text);
            assert!(
                matches!(error, AuthorError::WrongHexLength { bytes: got, .. } if got == bytes),
                "{text:?} gave {error:?}"
            );
            let message = error.to_string();
            assert!(message.contains("five bytes"), "{message}");
            assert!(message.contains("10 hex digits"), "{message}");
            assert!(message.contains("55 00 84 82 12"), "shows a usable example: {message}");
        }
    }

    #[test]
    fn a_raw_entry_that_is_not_hex_is_refused() {
        let error = from_hex("55 0G 84 82 12").expect_err("G is not a hex digit");
        assert!(matches!(error, AuthorError::NotHex { .. }), "{error:?}");
        let message = error.to_string();
        assert!(message.contains("five bytes"), "{message}");
        assert!(message.contains("55 00 84 82 12"), "{message}");
    }

    #[test]
    fn a_raw_entry_wider_than_facility_and_card_is_refused_with_the_range() {
        // The second byte is the top byte of the data field, which facility and
        // card do not cover. Refused, never zeroed.
        let error = from_hex("55 01 84 82 12").expect_err("0x01848212 is out of range");
        assert!(
            matches!(error, AuthorError::DataOutOfRange { data32: 0x0184_8212, .. }),
            "{error:?}"
        );
        let message = error.to_string();
        assert!(message.contains("0x01848212"), "names the value: {message}");
        assert!(message.contains("0x00FFFFFF"), "names the maximum: {message}");
        assert!(message.contains("24 bits"), "says why: {message}");
        assert!(message.contains("second byte must be 00"), "says the fix: {message}");
    }

    // ---- refusals name the range ----------------------------------------

    #[test]
    fn an_out_of_range_field_is_refused_and_the_range_is_shown() {
        for (customer, facility, card, field, entered) in [
            ("256", "0", "0", AuthorField::Customer, 256u64),
            ("0", "256", "0", AuthorField::Facility, 256),
            ("0", "0", "65536", AuthorField::Card, 65536),
            ("999999999", "0", "0", AuthorField::Customer, 999_999_999),
        ] {
            let error = from_parts(customer, facility, card).expect_err("out of range");
            assert!(
                matches!(
                    error,
                    AuthorError::OutOfRange { field: got, entered: got_entered, .. }
                        if got == field && got_entered == entered
                ),
                "{error:?}"
            );
            let message = error.to_string();
            assert!(message.contains(field.label()), "names the field: {message}");
            assert!(
                message.contains(field.range_label()),
                "shows the valid range: {message}"
            );
            assert!(!message.contains("invalid"), "never a bare 'invalid': {message}");
        }
    }

    #[test]
    fn a_field_that_is_not_a_number_is_refused_and_the_range_is_shown() {
        for (text, field) in [
            ("abc", AuthorField::Customer),
            ("", AuthorField::Facility),
            ("1.5", AuthorField::Card),
            ("-1", AuthorField::Customer),
            ("0x", AuthorField::Facility),
        ] {
            let error = from_parts_for_field(field, text).expect_err(text);
            assert!(
                matches!(error, AuthorError::NotANumber { field: got, .. } if got == field),
                "{error:?}"
            );
            let message = error.to_string();
            assert!(message.contains(field.label()), "{message}");
            assert!(message.contains(field.range_label()), "{message}");
            assert!(message.contains("0x"), "says hex needs a prefix: {message}");
        }
    }

    /// Put `text` in one field and a valid value in the other two.
    fn from_parts_for_field(
        field: AuthorField,
        text: &str,
    ) -> Result<Identity, AuthorError> {
        match field {
            AuthorField::Customer => from_parts(text, "0", "0"),
            AuthorField::Facility => from_parts("0", text, "0"),
            AuthorField::Card => from_parts("0", "0", text),
        }
    }

    #[test]
    fn no_refusal_is_ever_a_bare_invalid() {
        let errors = [
            AuthorError::NotANumber {
                field: AuthorField::Customer,
                entered: "abc".to_string(),
            },
            AuthorError::OutOfRange {
                field: AuthorField::Card,
                entered: 70_000,
                max: u16::MAX as u32,
            },
            AuthorError::NotHex {
                entered: "zz".to_string(),
            },
            AuthorError::WrongHexLength {
                bytes: 4,
                entered: "55 00 84 82".to_string(),
            },
            AuthorError::DataOutOfRange {
                data32: 0x0100_0000,
                max: MAX_DATA32,
            },
        ];
        for error in errors {
            let message = error.to_string();
            assert!(!message.is_empty());
            assert!(
                !message.to_lowercase().contains("invalid"),
                "says what is allowed instead: {message}"
            );
            assert!(
                message.contains("0x") || message.contains("decimal"),
                "a range or the expected shape is always shown: {message}"
            );
        }
    }

    #[test]
    fn an_out_of_range_entry_is_never_truncated_into_range() {
        // The refusal, not the truncation, is the point: a value that does not
        // fit must not silently become a different Identity.
        assert!(from_parts("256", "0", "0").is_err());
        assert!(from_parts("0", "256", "0").is_err());
        assert!(from_parts("0", "0", "65536").is_err());
        assert!(from_hex("55 01 84 82 12").is_err());
        assert!(from_hex("55 FF FF FF FF").is_err());
    }

    // ---- the confirmation shows exactly what will be written ------------

    #[test]
    fn the_preview_names_the_identity_and_its_payload() {
        let preview = preview(other_tag()).expect("a decoded reading is encodable");
        assert_eq!(preview.identity, other_tag());
        assert_eq!(preview.id, "56 00 53 C7 B3");
        assert_eq!(preview.hex, "560053C7B3");
        assert_eq!(preview.payload.len(), 24);
        assert_eq!(preview.payload_hex, crate::reader::hex(&preview.payload));
        // The payload carries the fields at the confirmed write offsets.
        assert_eq!(preview.payload[8], 0x56);
        assert_eq!(preview.payload[12], 0x56);
        assert_eq!(&preview.payload[16..20], &[0xB3, 0xC7, 0x53, 0x00]);
    }

    #[test]
    fn the_preview_is_shown_before_anything_is_sent() {
        // Nothing in this module can reach the Reader: a preview is a pure
        // function of an Identity, so showing it transmits nothing by
        // construction. Asserted as a property of the seam rather than a claim.
        let authored = from_parts("85", "132", "33298").expect("in range");
        let first = preview(authored).expect("in range");
        let second = preview(authored).expect("in range");
        assert_eq!(first, second, "a preview is a pure function of the entry");
    }

    #[test]
    fn the_preview_refuses_an_identity_it_cannot_encode() {
        // A Tag that reads with the reserved high byte set is readable but not
        // writable; the preview must say so instead of showing a payload.
        let unencodable = Identity {
            customer: 0x55,
            data32: 0x0100_0000,
        };
        let error = preview(unencodable).expect_err("out of range");
        assert!(
            matches!(error, AuthorError::DataOutOfRange { .. }),
            "{error:?}"
        );
    }

    // ---- the authoring seam with the write guard (S3 with S4) -----------

    #[test]
    fn a_write_of_an_authored_identity_is_refused_when_nothing_can_be_read() {
        // ADR 0001 at the authoring seam: the guard sees what the write position
        // reads as, and an authored Identity gets no exemption.
        let authored = from_parts("85", "132", "33298").expect("in range");
        let decision = write_guard::decide(None, authored);
        assert_eq!(decision, WriteDecision::RefuseUnreadable);
        assert!(!decision.allows_write());
        assert_eq!(
            classify(Evidence::Refused, authored),
            WriteOutcome::Refused,
            "a refusal is not a write and not a copy"
        );
    }

    #[test]
    fn a_blank_that_already_presents_the_authored_identity_is_refused() {
        // The Tag in the write position reads as what we are about to write, so
        // it is not a Blank: this is the case that locked a chip.
        let authored = from_parts("85", "132", "33298").expect("in range");
        assert_eq!(
            write_guard::decide(Some(authored), authored),
            WriteDecision::RefuseSameIdentity
        );
        // A Tag carrying any other Identity is a fair target.
        assert_eq!(
            write_guard::decide(Some(other_tag()), authored),
            WriteDecision::Proceed
        );
    }

    #[test]
    fn an_authored_write_that_cannot_be_read_back_is_unverified_not_failed() {
        let authored = from_parts("85", "132", "33298").expect("in range");
        let outcome = classify(Evidence::ReadbackUnreadable, authored);
        assert_eq!(outcome, WriteOutcome::Unverified);
        assert!(outcome.is_unknown());
        assert!(!outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn an_authored_write_read_back_is_a_confirmed_copy() {
        let authored = from_parts("85", "132", "33298").expect("in range");
        assert_eq!(
            classify(Evidence::Readback(Some(authored)), authored),
            WriteOutcome::Verified
        );
        assert!(write_outcome::WriteOutcome::Verified.counts_as_confirmed_copy());
    }

    #[test]
    fn the_entry_a_written_tag_reports_is_the_entry_that_wrote_it() {
        // The whole authoring promise in one test: type the fields, write, read
        // the read-back frame the hardware actually produced, and get the same
        // Identity back through the authoring path.
        let authored = from_parts("85", "132", "33298").expect("in range");
        let readback =
            Identity::from_read_payload(&test_frames::payload(test_frames::LF_WRITE_READBACK))
                .expect("read-back decodes");
        assert_eq!(readback, authored);
        let round_tripped = from_hex(&readback.id()).expect("its own id");
        assert_eq!(round_tripped, authored);
    }
}

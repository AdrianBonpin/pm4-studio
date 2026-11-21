//! The fail-closed write decision, extracted from the transport so ADR 0001 is
//! provable without a Reader plugged in.
//!
//! Command `0x0073` has no acknowledgement, so the only evidence that the tag
//! in the write position is the one the user intends to write is the read that
//! precedes it. Two cases must never reach the device:
//!
//!   1. The tag cannot be read at all. Writing then would be writing blind, and
//!      the tag might be the user's original credential.
//!   2. The tag already presents the Identity being written. That is almost
//!      certainly the source tag left in place, which is the ordering that has
//!      permanently locked a T5577.
//!
//! This module decides only. It sends nothing, and it cannot see whether the
//! device accepts the payload afterwards.

use crate::identity::Identity;

/// What the guard decides about one attempted write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteDecision {
    /// A tag was read and it does not already present the target Identity.
    Proceed,
    /// Refused: nothing could be read in the write position.
    RefuseUnreadable,
    /// Refused: the tag already presents the target Identity.
    RefuseSameIdentity,
}

impl WriteDecision {
    /// True only for `Proceed`. Every other outcome stops the write.
    pub fn allows_write(self) -> bool {
        matches!(self, WriteDecision::Proceed)
    }

    /// The refusal to show the user, or `None` when the write may proceed.
    ///
    /// `current` is the reading the decision was made from, when there was one.
    pub fn refusal_message(self, current: Option<Identity>) -> Option<String> {
        match self {
            WriteDecision::Proceed => None,
            WriteDecision::RefuseUnreadable => Some(
                "could not read the tag on the reader, so refusing to write blind. \
                 Put a blank 125 kHz tag on the reader and try again."
                    .to_string(),
            ),
            WriteDecision::RefuseSameIdentity => {
                let id = current
                    .map(|c| c.id())
                    .unwrap_or_else(|| "the identity being written".to_string());
                Some(format!(
                    "the tag on the reader already reads as {id} — that looks like the \
                     original tag. Take it off and put a blank tag on instead."
                ))
            }
        }
    }
}

/// Decide whether writing `target` may proceed, given what the tag in the write
/// position reads as.
///
/// `current` is `None` when the tag could not be read. The decision is closed:
/// anything other than a reading that differs from the target refuses.
pub fn decide(current: Option<Identity>, target: Identity) -> WriteDecision {
    match current {
        None => WriteDecision::RefuseUnreadable,
        Some(current) if current == target => WriteDecision::RefuseSameIdentity,
        Some(_) => WriteDecision::Proceed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::Identity;
    use crate::test_frames;

    /// The tag this app wrote in the recorded working example.
    fn written_tag() -> Identity {
        Identity::from_read_payload(&test_frames::payload(test_frames::LF_WRITE_READBACK))
            .expect("read-back capture decodes")
    }

    /// A different tag, read from the stored read capture.
    fn other_tag() -> Identity {
        Identity::from_read_payload(&test_frames::payload(test_frames::LF_READ_CARD_PRESENT))
            .expect("read capture decodes")
    }

    #[test]
    fn refuses_when_no_tag_could_be_read() {
        let decision = decide(None, written_tag());
        assert_eq!(decision, WriteDecision::RefuseUnreadable);
        assert!(!decision.allows_write());
    }

    #[test]
    fn refuses_when_the_tag_already_presents_the_target_identity() {
        // The stored read-back is the exact case that locked a chip: the source
        // tag left on the Reader while the same Identity was written.
        let decision = decide(Some(written_tag()), written_tag());
        assert_eq!(decision, WriteDecision::RefuseSameIdentity);
        assert!(!decision.allows_write());
    }

    #[test]
    fn allows_a_write_when_the_tag_reads_as_something_else() {
        let decision = decide(Some(other_tag()), written_tag());
        assert_eq!(decision, WriteDecision::Proceed);
        assert!(decision.allows_write());
    }

    #[test]
    fn the_whole_identity_is_compared_not_just_the_customer_byte() {
        let target = written_tag();
        let same_customer_other_card = Identity {
            customer: target.customer,
            data32: 0x00AB_CDEF,
        };
        assert_eq!(
            decide(Some(same_customer_other_card), target),
            WriteDecision::Proceed
        );

        let same_card_other_customer = Identity {
            customer: 0x77,
            data32: target.data32,
        };
        assert_eq!(
            decide(Some(same_card_other_customer), target),
            WriteDecision::Proceed
        );
    }

    #[test]
    fn the_unreadable_refusal_says_it_is_writing_blind() {
        let message = WriteDecision::RefuseUnreadable
            .refusal_message(None)
            .expect("a refusal has a message");
        assert!(message.contains("could not read"), "{message}");
        assert!(message.contains("write blind"), "{message}");
    }

    #[test]
    fn the_same_identity_refusal_names_the_identity_it_read() {
        let message = WriteDecision::RefuseSameIdentity
            .refusal_message(Some(written_tag()))
            .expect("a refusal has a message");
        assert!(message.contains("55 00 84 82 12"), "{message}");
        assert!(message.contains("blank tag"), "{message}");
    }

    #[test]
    fn a_proceeding_decision_has_no_refusal_message() {
        assert_eq!(
            WriteDecision::Proceed.refusal_message(Some(other_tag())),
            None
        );
    }
}

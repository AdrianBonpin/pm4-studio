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
//! # A Tag with no Identity is a legal write position
//!
//! The combined read ([`Identity::from_read_payload`]) folds "no Tag latched" and
//! "a Tag whose data field is empty" into the same `None`, because the read UI
//! only needs to know whether there is an Identity to show. That fold is exactly
//! wrong for a write: a Tag that is *present* and carries no Identity is a Tag
//! the app can see and can aim at — it is the state a blanked Tag is left in, and
//! it is not the blind write ADR 0001 refuses.
//!
//! The guard therefore takes [`TagPresence`] rather than `Option<Identity>`, so it
//! can keep apart the three things a write position can be:
//!
//!   * nothing readable (no Tag latched, or a reply too short to decode) — refuse;
//!   * a Tag with no Identity — a valid position, proceed;
//!   * a Tag carrying the target Identity — refuse, the original is still there;
//!   * a Tag carrying something else — proceed.
//!
//! Folding the second case into the first is what made every write path refuse a
//! Tag this app had itself blanked: the refusal was about the *reading* being
//! empty, when the refusal is about the *Tag* being unseen.
//!
//! This module decides only. It sends nothing, and it cannot see whether the
//! device accepts the payload afterwards.

use crate::identity::{Identity, TagPresence};

/// What the guard decides about one attempted write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteDecision {
    /// A tag was seen in the write position — with no Identity, or with one that
    /// is not the target — so the write may proceed.
    Proceed,
    /// Refused: nothing readable in the write position, so the write would be
    /// blind (ADR 0001, first condition).
    RefuseUnreadable,
    /// Refused: the tag already presents the target Identity (ADR 0001, second
    /// condition).
    RefuseSameIdentity,
}

/// Which of ADR 0001's two conditions a refusal came from.
///
/// The decision above says *that* a write may not happen; this says *why*, and
/// the why is what decides the remedy. The two conditions are not variations of
/// one problem:
///
///   * `Unreadable` — nothing could be read in the write position. The fix is
///     about the Tag being there at all: seat one, or use a Tag that reads.
///   * `AlreadyCarries` — the Tag was read perfectly well and already presents
///     the Identity being written. The fix is a different Tag: almost always the
///     original is still on the Reader.
///
/// A single `refused` with prose inside it made the two indistinguishable to
/// anything but a reader: the sound, the colour and the shape of the message
/// were the same. Carrying the cause as a value lets the message, the outcome
/// and the signal agree on which condition fired.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefusalCause {
    /// Nothing readable in the write position.
    Unreadable,
    /// The Tag in the write position already presents the Identity being written.
    AlreadyCarries,
}

impl RefusalCause {
    /// The stable wire name the UI switches on.
    pub fn as_str(self) -> &'static str {
        match self {
            RefusalCause::Unreadable => "unreadable",
            RefusalCause::AlreadyCarries => "already-carries",
        }
    }

    /// The cause behind a decision, or `None` when the decision allows the write.
    pub fn of(decision: WriteDecision) -> Option<RefusalCause> {
        match decision {
            WriteDecision::Proceed => None,
            WriteDecision::RefuseUnreadable => Some(RefusalCause::Unreadable),
            WriteDecision::RefuseSameIdentity => Some(RefusalCause::AlreadyCarries),
        }
    }

    // A read that failed before the guard could decide (a transport error, say)
    // is ADR 0001's first case too, so the call site names `Unreadable` directly.
    // A constructor for it could only ever return that one variant.
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
/// position is.
///
/// The decision is closed: the only two shapes that proceed are a Tag that was
/// seen and carries no Identity, and a Tag that was seen carrying something other
/// than the target. Everything the app could not see refuses, and so does the Tag
/// that already presents the target.
///
/// `presence` is [`TagPresence`] rather than `Option<Identity>` because a Tag that
/// is present with no Identity and a field with no Tag in it are different facts,
/// and only one of them is ADR 0001's blind write.
///
/// `target` is never range-checked: whether the Identity can be *encoded* is
/// [`Identity::write_payload`]'s decision, and a caller that reaches this point
/// with an unencodable target is refused there rather than here.
pub fn decide(presence: TagPresence, target: Identity) -> WriteDecision {
    match presence {
        // ADR 0001's first condition: nothing was seen, so writing would be
        // writing blind. A reply too short to decode says nothing about the
        // field, so it is not evidence that a Tag is there either.
        TagPresence::Absent | TagPresence::Unreadable => WriteDecision::RefuseUnreadable,
        // A Tag was seen and carries no Identity: the write position is known and
        // there is nothing of the user's to destroy under it. This is a legal
        // write position, not a blind write.
        TagPresence::Blank => WriteDecision::Proceed,
        TagPresence::Identified(current) if current == target => {
            WriteDecision::RefuseSameIdentity
        }
        TagPresence::Identified(_) => WriteDecision::Proceed,
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
        let decision = decide(TagPresence::Absent, written_tag());
        assert_eq!(decision, WriteDecision::RefuseUnreadable);
        assert!(!decision.allows_write());
    }

    #[test]
    fn refuses_when_the_tag_already_presents_the_target_identity() {
        // The stored read-back is the exact case that locked a chip: the source
        // tag left on the Reader while the same Identity was written.
        let decision = decide(TagPresence::Identified(written_tag()), written_tag());
        assert_eq!(decision, WriteDecision::RefuseSameIdentity);
        assert!(!decision.allows_write());
    }

    #[test]
    fn allows_a_write_when_the_tag_reads_as_something_else() {
        let decision = decide(TagPresence::Identified(other_tag()), written_tag());
        assert_eq!(decision, WriteDecision::Proceed);
        assert!(decision.allows_write());
    }

    #[test]
    fn a_tag_that_is_present_with_no_identity_is_a_valid_write_position() {
        // The state a blanked Tag is left in: latched and modulating, with no
        // Identity to replace. It is not an empty field — the Tag was seen — so
        // this is not ADR 0001's blind write, and refusing it made every write
        // path refuse a Tag this app had itself blanked.
        let decision = decide(TagPresence::Blank, written_tag());
        assert_eq!(decision, WriteDecision::Proceed);
        assert!(decision.allows_write());
    }

    #[test]
    fn a_cleared_tag_is_a_legal_write_position_for_a_new_identity() {
        // The requirement, at the gate every Clone, Batch and authored write goes
        // through: a tag Clear has already been on still reads as an Identity, so
        // it must be a write position with no read-before-write refusal. Its value
        // is the placeholder, which is not the target, so ADR 0001's "the original
        // is still in place" condition does not fire either.
        let cleared = Identity::CLEARED;
        let target = written_tag();
        assert_ne!(cleared, target, "the placeholder is not a real credential");

        let decision = decide(TagPresence::Identified(cleared), target);
        assert_eq!(decision, WriteDecision::Proceed);
        assert!(decision.allows_write());
        assert_eq!(RefusalCause::of(decision), None);
        assert_eq!(decision.refusal_message(Some(cleared)), None);
    }

    #[test]
    fn a_cleared_tag_is_not_the_blank_case_either() {
        // The placeholder is non-zero on purpose, so the presence decoder reports
        // `Identified` rather than `Blank`: the app can see a cleared Tag, which is
        // what makes it a write position at all.
        let mut payload = [0u8; crate::identity::LF_READ_PAYLOAD_LEN];
        payload[2] = 0x01;
        payload[12..16].copy_from_slice(&Identity::CLEARED.data32.to_le_bytes());

        assert_eq!(
            TagPresence::from_read_payload(&payload),
            TagPresence::Identified(Identity::CLEARED)
        );
        assert_eq!(
            decide(TagPresence::from_read_payload(&payload), written_tag()),
            WriteDecision::Proceed
        );
    }

    #[test]
    fn a_blank_write_position_raises_no_refusal_cause() {
        // Nothing was refused, so naming a cause would blame a condition the
        // guard never raised.
        assert_eq!(
            RefusalCause::of(decide(TagPresence::Blank, written_tag())),
            None
        );
    }

    #[test]
    fn a_present_tag_with_no_identity_is_not_the_unreadable_case() {
        // The whole defect in one assertion: the two used to arrive here as the
        // same value, so a blanked Tag was worded as "could not read the tag on
        // the reader" and refused forever.
        assert_ne!(
            decide(TagPresence::Blank, written_tag()),
            decide(TagPresence::Absent, written_tag())
        );
        assert_ne!(
            decide(TagPresence::Blank, written_tag()),
            decide(TagPresence::Unreadable, written_tag())
        );
    }

    #[test]
    fn an_undecodable_reply_still_refuses() {
        // ADR 0001 is not weakened by the blank case: a reply too short to hold
        // the fields says nothing about the Tag, so it is not evidence of one.
        let decision = decide(TagPresence::Unreadable, written_tag());
        assert_eq!(decision, WriteDecision::RefuseUnreadable);
        assert!(!decision.allows_write());
        assert_eq!(
            RefusalCause::of(decision),
            Some(RefusalCause::Unreadable)
        );
    }

    #[test]
    fn the_whole_identity_is_compared_not_just_the_customer_byte() {
        let target = written_tag();
        let same_customer_other_card = Identity {
            customer: target.customer,
            data32: 0x00AB_CDEF,
        };
        assert_eq!(
            decide(TagPresence::Identified(same_customer_other_card), target),
            WriteDecision::Proceed
        );

        let same_card_other_customer = Identity {
            customer: 0x77,
            data32: target.data32,
        };
        assert_eq!(
            decide(TagPresence::Identified(same_card_other_customer), target),
            WriteDecision::Proceed
        );
    }

    #[test]
    fn the_decision_table_is_closed() {
        // Every presence this codec can produce, against the target: the whole
        // guard in one table, so a change here is a visible decision.
        let target = written_tag();
        let table = [
            (TagPresence::Absent, WriteDecision::RefuseUnreadable),
            (TagPresence::Unreadable, WriteDecision::RefuseUnreadable),
            (TagPresence::Blank, WriteDecision::Proceed),
            (
                TagPresence::Identified(target),
                WriteDecision::RefuseSameIdentity,
            ),
            (TagPresence::Identified(other_tag()), WriteDecision::Proceed),
        ];
        for (presence, expected) in table {
            assert_eq!(decide(presence, target), expected, "{presence:?}");
        }
    }

    #[test]
    fn each_refusal_names_its_own_condition() {
        // The two conditions are two values, not two sentences: a caller can tell
        // them apart without reading the prose.
        assert_eq!(
            RefusalCause::of(WriteDecision::RefuseUnreadable),
            Some(RefusalCause::Unreadable)
        );
        assert_eq!(
            RefusalCause::of(WriteDecision::RefuseSameIdentity),
            Some(RefusalCause::AlreadyCarries)
        );
        assert_eq!(RefusalCause::of(WriteDecision::Proceed), None);
    }

    #[test]
    fn the_causes_carry_distinct_wire_names() {
        assert_eq!(RefusalCause::Unreadable.as_str(), "unreadable");
        assert_eq!(RefusalCause::AlreadyCarries.as_str(), "already-carries");
        assert_ne!(
            RefusalCause::Unreadable.as_str(),
            RefusalCause::AlreadyCarries.as_str()
        );
    }

    #[test]
    fn a_read_that_failed_before_the_guard_decided_is_the_unreadable_cause() {
        // ADR 0001's first case, whichever way it arrives: nothing could be read
        // in the write position, so the fix is to seat a Tag that reads. This is
        // the cause `reader.rs` names when the read itself failed.
        assert_eq!(RefusalCause::of(WriteDecision::RefuseUnreadable), Some(RefusalCause::Unreadable));
        assert_eq!(RefusalCause::Unreadable.as_str(), "unreadable");
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

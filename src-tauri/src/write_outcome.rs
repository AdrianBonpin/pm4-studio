//! What became of one attempted write, and which outcomes are copies.
//!
//! A write produces one of these outcomes, and only one of them is evidence that
//! a copy exists:
//!
//!   * `Refused` — the guard stopped it, so nothing was transmitted.
//!   * `Verified` — transmitted, and the read-back presented the target
//!     Identity. This is the only confirmed copy.
//!   * `Cleared` — transmitted with the cleared placeholder Identity, and the
//!     read-back presented exactly that placeholder. The Tag carries a value no
//!     system issued, and it is still a Tag the app can see and write to. Never
//!     a copy: nothing in the library gained one.
//!   * `Destroyed` — transmitted with the neutral Identity, and the read-back
//!     presented no Identity at all. The Tag keeps answering readers and
//!     permanently refuses further data. Never a copy.
//!   * `Erased` — transmitted an empty NDEF TLV, and the read-back presented a
//!     Tag with a valid zero-length NDEF message. The Tag keeps its identity,
//!     its Capability Container and its format; only the NDEF *content* is gone.
//!     Never a copy, and never "verified".
//!   * `Unverified` — transmitted, but the read-back did not confirm it (no
//!     reading at all, or a different one). The Tag's state is genuinely
//!     unknown, so counting it would be a lie about a credential.
//!   * `Failed` — the write never reached the device, or a clearing write was
//!     transmitted and the read-back showed the thing to be cleared is still
//!     there.
//!
//! A single `verified: bool` cannot carry this: it collapses "refused" and
//! "failed" into one falsy value and invites treating "unknown" as "not written".
//! Nothing here touches the Reader, so every rule below is provable with no
//! hardware attached.
//!
//! # Clearing is judged by a positive read-back; destroying by an absence
//!
//! The two operations do not have the same success condition, and one classifier
//! cannot serve both:
//!
//!   * **Clear** writes the non-zero placeholder ([`Identity::CLEARED`]), so its
//!     success is the ordinary kind: the read-back presents exactly that value.
//!     This is a *positive* confirmation — the same shape a copy uses — which is
//!     why a cleared Tag is one the app can see and write to again.
//!   * **Destroy** writes the all-zero data field, which the Identity codec
//!     decodes as "no reading", so its success condition is the *absence* of an
//!     Identity. Judging it by the copy rule would call every successful destroy
//!     "unverified", which is why `classify_destroy` exists (ADR 0003).
//!
//! The two words are kept apart everywhere: a Clear that landed is `Cleared` and
//! a Destroy that landed is `Destroyed`, and neither classifier can produce the
//! other's outcome. That is what stops a destructive result being reported in the
//! words of a reversible one.
//!
//! # Erasing inverts it again, and needs its own word
//!
//! Erasing NDEF content writes an empty Type 2 NDEF TLV (`03 00 FE`) over the
//! message area. The success condition is that the Tag still reads *and* its
//! user memory now carries a valid zero-length NDEF TLV — a Tag that is present
//! with no Records, which is not the same as a Blank Tag and not the same as a
//! copy. `classify_erase` keeps that apart from `Verified` so no Snapshot's
//! confirmed-copy count can be raised by clearing a Tag.

use crate::identity::Identity;

/// What became of one attempted write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteOutcome {
    /// The guard refused: an unreadable tag, or a tag that already presents the
    /// target Identity. No write was attempted.
    Refused,
    /// The write was transmitted and the read-back matched the target Identity.
    Verified,
    /// A clearing write was transmitted and the Tag presents exactly the
    /// cleared placeholder Identity. Distinct from `Verified` on purpose: this
    /// places a value nobody issued, not the user's credential, and it is not
    /// "verified" in the sense a copy is.
    Cleared,
    /// A destroying write was transmitted and the Tag no longer presents an
    /// Identity. Distinct from `Verified` on purpose: a destroy is not a copy,
    /// and it is not "verified" in the sense a copy is.
    Destroyed,
    /// An erasing write was transmitted and the Tag reads back as present with a
    /// valid, zero-length NDEF message. Distinct from `Verified` on purpose: an
    /// erase destroys content rather than placing a copy, and it is not
    /// "verified" in the sense a copy is.
    Erased,
    /// The write was transmitted, but the read-back could not confirm it.
    Unverified,
    /// The write could not be transmitted, or a clearing write was transmitted
    /// and the Tag still presents an Identity.
    Failed,
    /// A clearing write was transmitted and the Tag still presents an Identity,
    /// so it will not accept a write. Distinct from `Failed` because it is not a
    /// generic failure but a fact about the chip — it has already been written
    /// once, or it was never writable — and distinct from `Unverified` because
    /// the state of the Tag is known: nothing changed (ADR 0007).
    WillNotAcceptWrites,
}

impl WriteOutcome {
    /// The stable wire name the UI switches on.
    pub fn as_str(self) -> &'static str {
        match self {
            WriteOutcome::Refused => "refused",
            WriteOutcome::Verified => "verified",
            WriteOutcome::Cleared => "cleared",
            WriteOutcome::Destroyed => "destroyed",
            WriteOutcome::Erased => "erased",
            WriteOutcome::Unverified => "unverified",
            WriteOutcome::Failed => "failed",
            WriteOutcome::WillNotAcceptWrites => "willNotAcceptWrites",
        }
    }

    /// True only for `Verified`. This is the whole counting rule: a Snapshot's
    /// count rises for a confirmed copy and for nothing else.
    pub fn counts_as_confirmed_copy(self) -> bool {
        matches!(self, WriteOutcome::Verified)
    }

    /// True when the Tag may hold the Identity but nothing proved it. The UI
    /// says "unknown" for this, never success and never a definitive failure.
    pub fn is_unknown(self) -> bool {
        matches!(self, WriteOutcome::Unverified)
    }
}

/// The evidence one guarded write produced, in the order the write path
/// produces it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Evidence {
    /// Nothing was transmitted: the guard refused, or no tag could be read in
    /// the write position.
    Refused,
    /// The write command could not be transmitted.
    NotTransmitted,
    /// The device accepted the frame and declined the operation, so nothing was
    /// written. `0x0082` answers status `32` this way for a tag selector outside
    /// `0..=4` (docs/PROTOCOL.md), which is a refusal to act rather than an
    /// attempt whose result is unknown.
    Declined,
    /// The write was transmitted; this is what the Tag read back, if anything.
    /// `None` means the read-back reported no Identity, which is a destroyed Tag
    /// for a destroying write and an unknown result for a copying one.
    Readback(Option<Identity>),
    /// The write was transmitted, but the Tag could not be read back at all, so
    /// nothing is known about what it now carries.
    ReadbackUnreadable,
}

/// Classify one attempt from its evidence and the Identity it was aiming at.
pub fn classify(evidence: Evidence, target: Identity) -> WriteOutcome {
    match evidence {
        Evidence::Readback(Some(found)) => {
            classify_evidence(JudgedEvidence::Readback(Some(found == target)))
        }
        Evidence::Readback(None) => classify_evidence(JudgedEvidence::Readback(None)),
        Evidence::Refused => classify_evidence(JudgedEvidence::Refused),
        Evidence::NotTransmitted => classify_evidence(JudgedEvidence::NotTransmitted),
        Evidence::Declined => classify_evidence(JudgedEvidence::NotTransmitted),
        // Sent, but the Tag could not be read back at all: nothing is known
        // about what it carries, so this is unknown and never a failure.
        Evidence::ReadbackUnreadable => classify_evidence(JudgedEvidence::Readback(None)),
    }
}

/// Classify one *clearing* attempt, where success is the read-back presenting
/// the cleared placeholder.
///
/// This is a positive confirmation, unlike destroying: the write aimed at
/// [`Identity::CLEARED`], so the ordinary rule applies — the read-back either
/// presents that value or it does not. Each case is its own fact:
///
///   * nothing was transmitted → `Refused` or `Failed`, as for a copy;
///   * transmitted and the read-back presents the placeholder → `Cleared`;
///   * transmitted and the read-back presents any *other* Identity, or no
///     Identity at all → `WillNotAcceptWrites`. A chip that does not carry the
///     value it was just sent is one that will not take a write (ADR 0007);
///   * transmitted but the Tag could not be read back → `Unverified`.
///
/// A `Cleared` outcome is never a confirmed copy: the placeholder is not the
/// user's credential, so it must not raise any Snapshot's count.
pub fn classify_clear(evidence: Evidence) -> WriteOutcome {
    match evidence {
        Evidence::Refused => WriteOutcome::Refused,
        Evidence::NotTransmitted => WriteOutcome::Failed,
        // The device declined to act, so nothing was written: the clear did not
        // take.
        Evidence::Declined => WriteOutcome::Failed,
        Evidence::Readback(Some(found)) if found == Identity::CLEARED => WriteOutcome::Cleared,
        // Including a read-back that presents no Identity: the Tag does not
        // carry the placeholder, which is the only thing this write asked for.
        Evidence::Readback(_) => WriteOutcome::WillNotAcceptWrites,
        Evidence::ReadbackUnreadable => WriteOutcome::Unverified,
    }
}

/// Classify one *destroying* attempt, where success is the absence of an
/// Identity.
///
/// This is deliberately not `classify` with a neutral target: `classify` would
/// compare the read-back against an Identity, and a destroyed Tag has no
/// Identity to compare against. Each case is its own fact:
///
///   * nothing was transmitted → `Refused` or `Failed`, as for a copy;
///   * transmitted and the Tag presents no Identity → `Destroyed`;
///   * transmitted and the Tag still presents an Identity →
///     `WillNotAcceptWrites`, because a chip that reads back its own Identity
///     after a write is one that will not take one: it has already been written
///     once, or it was never writable. Its own outcome, not `Failed`, because
///     the useful reading is about the chip rather than about the attempt
///     (ADR 0007);
///   * transmitted but the Tag could not be read back → `Unverified`.
///
/// A `Destroyed` outcome is never a confirmed copy, and it is never `Cleared`:
/// the two operations have different success evidence, so one cannot stand in
/// for the other.
pub fn classify_destroy(evidence: Evidence) -> WriteOutcome {
    match evidence {
        Evidence::Refused => WriteOutcome::Refused,
        Evidence::NotTransmitted => WriteOutcome::Failed,
        // The device declined to act, so nothing was written and the Tag still
        // carries its Identity: the destroy did not take.
        Evidence::Declined => WriteOutcome::Failed,
        Evidence::Readback(None) => WriteOutcome::Destroyed,
        // A Tag that still presents an Identity was not destroyed. Any Identity
        // counts here, including the cleared placeholder: a read-back that
        // reports an Identity at all is not a destruction.
        Evidence::Readback(Some(_)) => WriteOutcome::WillNotAcceptWrites,
        Evidence::ReadbackUnreadable => WriteOutcome::Unverified,
    }
}

/// Classify one *erasing* attempt, where success is "the Tag is present and
/// carries a valid zero-length NDEF message".
///
/// This is not `classify` with an empty target: an erased Tag is a Tag with no
/// Records, and the read-back that proves it is a parsed empty TLV rather than a
/// message that matched. Each case is its own fact:
///
///   * nothing was transmitted → `Refused` or `Failed`, as for a copy;
///   * transmitted and the read-back carries a valid empty NDEF TLV with the
///     Tag's identity and Capability Container intact → `Erased`;
///   * transmitted and the Tag still reads content, or its identity/CC changed
///     → `Failed`, because the erase did not leave a Tag that is present with
///     no Records;
///   * transmitted but the Tag could not be read back → `Unverified`, because
///     the erase may or may not have landed.
///
/// An `Erased` outcome is never a confirmed copy: it removes a message rather
/// than creating one, so it must not raise any Snapshot's count.
pub fn classify_erase(evidence: JudgedEvidence) -> WriteOutcome {
    match evidence {
        JudgedEvidence::Refused => WriteOutcome::Refused,
        JudgedEvidence::NotTransmitted => WriteOutcome::Failed,
        JudgedEvidence::Readback(Some(true)) => WriteOutcome::Erased,
        // The Tag was read and does not show an erased message: a definite
        // failure, not an unknown. Claiming "unknown" here would send the user
        // looking for a problem that the read already settled.
        JudgedEvidence::Readback(Some(false)) => WriteOutcome::Failed,
        JudgedEvidence::Readback(None) => WriteOutcome::Unverified,
    }
}

/// The same evidence, with the read-back already judged as "this is the thing
/// that was being written" or not.
///
/// A Draft write aims at a whole NDEF message rather than an Identity, so it
/// cannot hand over an `Identity` to compare. Judging the read-back is the only
/// part that differs, and it happens in one place per target kind; the rule that
/// turns the result into an outcome stays here.
pub enum JudgedEvidence {
    /// Nothing was transmitted.
    Refused,
    /// The write could not be transmitted, or the device declined to act.
    NotTransmitted,
    /// The write was transmitted; `Some(true)` means the read-back presented
    /// exactly what was written.
    Readback(Option<bool>),
}

/// Classify one attempt from evidence that has already been judged.
pub fn classify_evidence(evidence: JudgedEvidence) -> WriteOutcome {
    match evidence {
        JudgedEvidence::Refused => WriteOutcome::Refused,
        JudgedEvidence::NotTransmitted => WriteOutcome::Failed,
        JudgedEvidence::Readback(Some(true)) => WriteOutcome::Verified,
        // Sent, but the tag did not read back as what was written: the write
        // happened and its result is unknown.
        JudgedEvidence::Readback(_) => WriteOutcome::Unverified,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target() -> Identity {
        Identity {
            customer: 0x55,
            data32: 0x0084_8212,
        }
    }


    fn other() -> Identity {
        Identity {
            customer: 0x55,
            data32: 0x0053_C7B3,
        }
    }

    #[test]
    fn only_a_verified_write_is_a_confirmed_copy() {
        assert!(WriteOutcome::Verified.counts_as_confirmed_copy());

        assert!(!WriteOutcome::Refused.counts_as_confirmed_copy());
        assert!(!WriteOutcome::Unverified.counts_as_confirmed_copy());
        assert!(!WriteOutcome::Failed.counts_as_confirmed_copy());
        assert!(!WriteOutcome::WillNotAcceptWrites.counts_as_confirmed_copy());
    }

    #[test]
    fn a_refusal_is_not_a_write_and_not_a_copy() {
        assert_eq!(classify(Evidence::Refused, target()), WriteOutcome::Refused);
        assert!(!WriteOutcome::Refused.counts_as_confirmed_copy());
    }

    #[test]
    fn a_readback_that_matches_is_verified() {
        assert_eq!(
            classify(Evidence::Readback(Some(target())), target()),
            WriteOutcome::Verified
        );
    }

    #[test]
    fn a_transmitted_write_with_no_readback_is_unknown_not_verified() {
        let outcome = classify(Evidence::Readback(None), target());
        assert_eq!(outcome, WriteOutcome::Unverified);
        assert!(outcome.is_unknown());
        assert!(!outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn a_readback_that_presents_something_else_is_unknown_not_a_copy() {
        // The write went out, the tag reads as another Identity: nothing proves
        // the copy landed, so it is unknown rather than failed or verified.
        let outcome = classify(Evidence::Readback(Some(other())), target());
        assert_eq!(outcome, WriteOutcome::Unverified);
        assert!(!outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn a_write_that_never_transmitted_is_failed() {
        let outcome = classify(Evidence::NotTransmitted, target());
        assert_eq!(outcome, WriteOutcome::Failed);
        assert!(!outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn a_request_the_device_declined_is_not_treated_as_unknown() {
        // `0x0082` answers status 32 for a bad tag selector and writes nothing
        // (docs/PROTOCOL.md), so the Tag is not left in an unknown state.
        let outcome = classify(Evidence::Declined, target());
        assert_eq!(outcome, WriteOutcome::Failed);
        assert!(!outcome.is_unknown());
        assert!(!outcome.counts_as_confirmed_copy());
    }

    // ---- judged evidence, which is how a Draft write classifies ----------

    #[test]
    fn a_judged_readback_that_matches_what_was_written_is_verified() {
        assert_eq!(
            classify_evidence(JudgedEvidence::Readback(Some(true))),
            WriteOutcome::Verified
        );
    }

    #[test]
    fn a_judged_readback_that_differs_is_unknown_not_failed() {
        // A whole NDEF message that reads back different is still a Tag that
        // may hold part of it: unverified, never a definitive failure.
        let outcome = classify_evidence(JudgedEvidence::Readback(Some(false)));
        assert_eq!(outcome, WriteOutcome::Unverified);
        assert!(outcome.is_unknown());
        assert!(!outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn a_judged_readback_that_never_happened_is_unknown() {
        let outcome = classify_evidence(JudgedEvidence::Readback(None));
        assert_eq!(outcome, WriteOutcome::Unverified);
        assert!(!outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn judged_refusal_and_non_transmission_keep_their_meanings() {
        assert_eq!(
            classify_evidence(JudgedEvidence::Refused),
            WriteOutcome::Refused
        );
        assert_eq!(
            classify_evidence(JudgedEvidence::NotTransmitted),
            WriteOutcome::Failed
        );
    }

    #[test]
    fn the_outcomes_carry_distinct_wire_names() {
        let names: Vec<&str> = [
            WriteOutcome::Refused,
            WriteOutcome::Verified,
            WriteOutcome::Cleared,
            WriteOutcome::Destroyed,
            WriteOutcome::Erased,
            WriteOutcome::Unverified,
            WriteOutcome::Failed,
            WriteOutcome::WillNotAcceptWrites,
        ]
        .iter()
        .map(|o| o.as_str())
        .collect();
        assert_eq!(
            names,
            vec![
                "refused",
                "verified",
                "cleared",
                "destroyed",
                "erased",
                "unverified",
                "failed",
                "willNotAcceptWrites"
            ]
        );
    }

    /// What a **Clear** read back: the placeholder, or anything else.
    fn cleared() -> Identity {
        Identity::CLEARED
    }

    // ---- clear: success is the placeholder on the Tag -------------------

    #[test]
    fn a_cleared_write_is_never_a_confirmed_copy_and_never_unknown() {
        // The placeholder is not the user's credential, so nothing in the library
        // gained a copy; and a read-back that presented it is a definite result.
        assert!(!WriteOutcome::Cleared.counts_as_confirmed_copy());
        assert!(!WriteOutcome::Cleared.is_unknown());
    }

    #[test]
    fn a_transmitted_clear_whose_readback_presents_the_placeholder_is_cleared() {
        assert_eq!(
            classify_clear(Evidence::Readback(Some(cleared()))),
            WriteOutcome::Cleared
        );
    }

    #[test]
    fn a_clear_that_left_another_identity_behind_will_not_accept_writes() {
        // The chip kept something that is not the placeholder, so the write did
        // not take. That is a fact about the chip, not a generic failure and not
        // an unknown (ADR 0007).
        let outcome = classify_clear(Evidence::Readback(Some(target())));
        assert_eq!(outcome, WriteOutcome::WillNotAcceptWrites);
        assert!(!outcome.is_unknown());
        assert!(!outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn a_clear_that_left_the_tag_carrying_nothing_did_not_take() {
        // Clear aims at a value, so a Tag reading as carrying no Identity does
        // not satisfy it. This is the one case a destroying write calls success
        // and a clearing write does not, which is why the two classifiers are not
        // one function with a flag.
        assert_eq!(
            classify_clear(Evidence::Readback(None)),
            WriteOutcome::WillNotAcceptWrites
        );
        assert_eq!(
            classify_destroy(Evidence::Readback(None)),
            WriteOutcome::Destroyed
        );
    }

    #[test]
    fn a_clear_refusal_stays_a_refusal_and_a_lost_transmission_stays_failed() {
        assert_eq!(classify_clear(Evidence::Refused), WriteOutcome::Refused);
        assert_eq!(
            classify_clear(Evidence::NotTransmitted),
            WriteOutcome::Failed
        );
        assert_eq!(classify_clear(Evidence::Declined), WriteOutcome::Failed);
    }

    #[test]
    fn a_clear_whose_read_back_could_not_be_read_is_unknown_not_cleared() {
        let outcome = classify_clear(Evidence::ReadbackUnreadable);
        assert_eq!(outcome, WriteOutcome::Unverified);
        assert!(outcome.is_unknown());
        assert!(!outcome.counts_as_confirmed_copy());
    }

    // ---- destroy: a read-back that still identifies is its own fact -----

    #[test]
    fn a_destroy_whose_readback_still_identifies_will_not_accept_writes() {
        // The tag read back, and it still carries an Identity: the write did not
        // take. That is evidence about the chip, not a generic failure and not an
        // unknown, so it gets its own outcome (ADR 0007).
        let outcome = classify_destroy(Evidence::Readback(Some(target())));
        assert_eq!(outcome, WriteOutcome::WillNotAcceptWrites);
        assert_ne!(outcome, WriteOutcome::Failed);
        assert_ne!(outcome, WriteOutcome::Unverified);
        assert_ne!(outcome, WriteOutcome::Destroyed);
        assert_ne!(outcome, WriteOutcome::Cleared);
        assert!(!outcome.is_unknown());
        assert!(!outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn a_still_identifying_readback_is_not_a_refusal() {
        // The guard never saw it: bytes were sent. Reporting a refusal would say
        // nothing was attempted, which is the opposite of what happened.
        assert_ne!(
            classify_destroy(Evidence::Readback(Some(other()))),
            WriteOutcome::Refused
        );
    }

    // ---- erasing: success is a present Tag with no Records ---------------

    #[test]
    fn an_erased_write_is_not_a_confirmed_copy() {
        // Erasing removes an NDEF message. Nothing in the library gained a copy,
        // so no Snapshot's count may move.
        assert!(!WriteOutcome::Erased.counts_as_confirmed_copy());
    }

    #[test]
    fn an_erased_write_is_not_unknown() {
        // A read-back showing a valid empty TLV is a definite result, not a
        // shrug: it is the expected evidence of a successful erase.
        assert!(!WriteOutcome::Erased.is_unknown());
    }

    #[test]
    fn an_erase_is_never_worded_as_verified() {
        // The whole point of a separate word: clearing content is not placing a
        // copy, so "verified" would say something that did not happen.
        assert_ne!(WriteOutcome::Erased.as_str(), WriteOutcome::Verified.as_str());
        assert_eq!(
            classify_erase(JudgedEvidence::Readback(Some(true))),
            WriteOutcome::Erased
        );
    }

    #[test]
    fn an_erase_whose_readback_shows_an_empty_tlv_is_erased() {
        assert_eq!(
            classify_erase(JudgedEvidence::Readback(Some(true))),
            WriteOutcome::Erased
        );
    }

    #[test]
    fn an_erase_whose_readback_still_holds_content_failed() {
        // The Tag was read and the message is still there. That is a failure the
        // read already settled, not an unknown to go looking into.
        let outcome = classify_erase(JudgedEvidence::Readback(Some(false)));
        assert_eq!(outcome, WriteOutcome::Failed);
        assert!(!outcome.is_unknown());
        assert!(!outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn an_erase_whose_read_back_could_not_be_read_is_unknown_not_erased() {
        // Nothing was observed after the write, so claiming the content is gone
        // would be a claim about bytes the app did not see.
        let outcome = classify_erase(JudgedEvidence::Readback(None));
        assert_eq!(outcome, WriteOutcome::Unverified);
        assert!(outcome.is_unknown());
        assert!(!outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn an_erase_refusal_stays_a_refusal_and_a_lost_transmission_stays_failed() {
        assert_eq!(
            classify_erase(JudgedEvidence::Refused),
            WriteOutcome::Refused
        );
        assert_eq!(
            classify_erase(JudgedEvidence::NotTransmitted),
            WriteOutcome::Failed
        );
    }

    // ---- destroying: success is the absence of an Identity ---------------

    #[test]
    fn a_destroyed_write_is_not_a_confirmed_copy() {
        // The whole counting rule in one line: destroying an Identity can never
        // raise a Snapshot's count of Tags that carry it.
        assert!(!WriteOutcome::Destroyed.counts_as_confirmed_copy());
    }

    #[test]
    fn a_destroyed_write_is_not_unknown() {
        // A destroying write whose read-back reports nothing is a definite
        // result, not a shrug: this is the expected evidence of success.
        assert!(!WriteOutcome::Destroyed.is_unknown());
    }

    #[test]
    fn a_transmitted_destroy_with_no_identity_reading_is_destroyed() {
        assert_eq!(
            classify_destroy(Evidence::Readback(None)),
            WriteOutcome::Destroyed
        );
    }

    #[test]
    fn a_transmitted_destroy_that_still_presents_an_identity_will_not_accept_writes() {
        // The destroy did not take. That is not "unknown" — the Tag was read and
        // it still carries a credential — and it is no longer a generic failure
        // either: it is the one thing this app can learn about whether a 125 kHz
        // tag accepts writes (ADR 0007).
        let outcome = classify_destroy(Evidence::Readback(Some(target())));
        assert_eq!(outcome, WriteOutcome::WillNotAcceptWrites);
        assert!(!outcome.counts_as_confirmed_copy());

        // A different Identity is just as much a Tag that took nothing.
        assert_eq!(
            classify_destroy(Evidence::Readback(Some(other()))),
            WriteOutcome::WillNotAcceptWrites
        );
    }

    #[test]
    fn a_destroy_refusal_stays_a_refusal_and_a_lost_transmission_stays_failed() {
        assert_eq!(classify_destroy(Evidence::Refused), WriteOutcome::Refused);
        assert_eq!(
            classify_destroy(Evidence::NotTransmitted),
            WriteOutcome::Failed
        );
    }

    #[test]
    fn a_destroy_whose_read_back_could_not_be_read_is_unknown_not_destroyed() {
        // Nothing was observed after the write, so claiming the Tag is destroyed
        // would be a claim about a credential the app did not see.
        let outcome = classify_destroy(Evidence::ReadbackUnreadable);
        assert_eq!(outcome, WriteOutcome::Unverified);
        assert!(outcome.is_unknown());
        assert!(!outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn neither_classifier_can_produce_the_other_outcome() {
        // The requirement, at the pure seam: a Clear that landed is never
        // reported as a Destroy, and a Destroy that landed is never reported as
        // a Clear — for any evidence either classifier can be handed.
        let every_evidence = [
            Evidence::Refused,
            Evidence::NotTransmitted,
            Evidence::Declined,
            Evidence::Readback(None),
            Evidence::Readback(Some(target())),
            Evidence::Readback(Some(cleared())),
            Evidence::ReadbackUnreadable,
        ];
        for evidence in every_evidence {
            assert_ne!(
                classify_clear(evidence),
                WriteOutcome::Destroyed,
                "a clear must never report a destroy: {evidence:?}"
            );
            assert_ne!(
                classify_destroy(evidence),
                WriteOutcome::Cleared,
                "a destroy must never report a clear: {evidence:?}"
            );
        }
    }

    #[test]
    fn a_copy_whose_read_back_could_not_be_read_is_unknown_too() {
        assert_eq!(
            classify(Evidence::ReadbackUnreadable, target()),
            WriteOutcome::Unverified
        );
    }
}

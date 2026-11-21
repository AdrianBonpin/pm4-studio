//! What became of one attempted write, and which outcomes are copies.
//!
//! A write produces one of four outcomes, and only one of them is evidence that
//! a copy exists:
//!
//!   * `Refused` — the guard stopped it, so nothing was transmitted.
//!   * `Verified` — transmitted, and the read-back presented the target
//!     Identity. This is the only confirmed copy.
//!   * `Unverified` — transmitted, but the read-back did not confirm it (no
//!     reading at all, or a different one). The Tag's state is genuinely
//!     unknown, so counting it would be a lie about a credential.
//!   * `Failed` — the write never reached the device.
//!
//! A single `verified: bool` cannot carry this: it collapses "refused" and
//! "failed" into one falsy value and invites treating "unknown" as "not written".
//! Nothing here touches the Reader, so every rule below is provable with no
//! hardware attached.

use crate::identity::Identity;

/// What became of one attempted write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteOutcome {
    /// The guard refused: an unreadable tag, or a tag that already presents the
    /// target Identity. No write was attempted.
    Refused,
    /// The write was transmitted and the read-back matched the target Identity.
    Verified,
    /// The write was transmitted, but the read-back could not confirm it.
    Unverified,
    /// The write could not be transmitted.
    Failed,
}

impl WriteOutcome {
    /// The stable wire name the UI switches on.
    pub fn as_str(self) -> &'static str {
        match self {
            WriteOutcome::Refused => "refused",
            WriteOutcome::Verified => "verified",
            WriteOutcome::Unverified => "unverified",
            WriteOutcome::Failed => "failed",
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
    Readback(Option<Identity>),
}

/// Classify one attempt from its evidence and the Identity it was aiming at.
pub fn classify(evidence: Evidence, target: Identity) -> WriteOutcome {
    match evidence {
        Evidence::Readback(Some(found)) => classify_evidence(JudgedEvidence::Readback(Some(found == target))),
        Evidence::Readback(None) => classify_evidence(JudgedEvidence::Readback(None)),
        Evidence::Refused => classify_evidence(JudgedEvidence::Refused),
        Evidence::NotTransmitted => classify_evidence(JudgedEvidence::NotTransmitted),
        Evidence::Declined => classify_evidence(JudgedEvidence::NotTransmitted),
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
    fn the_four_outcomes_carry_distinct_wire_names() {
        let names: Vec<&str> = [
            WriteOutcome::Refused,
            WriteOutcome::Verified,
            WriteOutcome::Unverified,
            WriteOutcome::Failed,
        ]
        .iter()
        .map(|o| o.as_str())
        .collect();
        assert_eq!(names, vec!["refused", "verified", "unverified", "failed"]);
    }
}

//! What became of one attempted write, and which outcomes are copies.
//!
//! A write produces one of five outcomes, and only one of them is evidence that
//! a copy exists:
//!
//!   * `Refused` — the guard stopped it, so nothing was transmitted.
//!   * `Verified` — transmitted, and the read-back presented the target
//!     Identity. This is the only confirmed copy.
//!   * `Blanked` — transmitted with the neutral Identity, and the read-back
//!     presented no Identity at all. The Tag no longer carries a credential.
//!     This is a *destruction*, never a copy: nothing in the library gained one.
//!   * `Unverified` — transmitted, but the read-back did not confirm it (no
//!     reading at all, or a different one). The Tag's state is genuinely
//!     unknown, so counting it would be a lie about a credential.
//!   * `Failed` — the write never reached the device.
//!
//! A single `verified: bool` cannot carry this: it collapses "refused" and
//! "failed" into one falsy value and invites treating "unknown" as "not written".
//! Nothing here touches the Reader, so every rule below is provable with no
//! hardware attached.
//!
//! # Blanking inverts the success condition
//!
//! The Identity codec treats an all-zero data field as "no reading", so a Tag
//! that has been blanked reads back as *nothing* rather than as a neutral
//! Identity. Judging a blanking write by the copy rule would therefore call
//! every successful blanking "unverified", which is why `classify_blank`
//! exists: for a blanking write, "the read-back presents no Identity" **is**
//! the success condition, and "the read-back still presents an Identity" is the
//! failure. The two rules live here together so that neither can drift into the
//! other's territory.

use crate::identity::Identity;

/// What became of one attempted write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteOutcome {
    /// The guard refused: an unreadable tag, or a tag that already presents the
    /// target Identity. No write was attempted.
    Refused,
    /// The write was transmitted and the read-back matched the target Identity.
    Verified,
    /// A blanking write was transmitted and the Tag no longer presents an
    /// Identity. Distinct from `Verified` on purpose: a blanking write is not a
    /// copy, and it is not "verified" in the sense a copy is.
    Blanked,
    /// The write was transmitted, but the read-back could not confirm it.
    Unverified,
    /// The write could not be transmitted, or a blanking write was transmitted
    /// and the Tag still presents an Identity.
    Failed,
}

impl WriteOutcome {
    /// The stable wire name the UI switches on.
    pub fn as_str(self) -> &'static str {
        match self {
            WriteOutcome::Refused => "refused",
            WriteOutcome::Verified => "verified",
            WriteOutcome::Blanked => "blanked",
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
    /// The write was transmitted; this is what the Tag read back, if anything.
    /// `None` means the read-back reported no Identity, which is a blanked Tag
    /// for a blanking write and an unknown result for a copying one.
    Readback(Option<Identity>),
    /// The write was transmitted, but the Tag could not be read back at all, so
    /// nothing is known about what it now carries.
    ReadbackUnreadable,
}

/// Classify one attempt from its evidence and the Identity it was aiming at.
pub fn classify(evidence: Evidence, target: Identity) -> WriteOutcome {
    match evidence {
        Evidence::Refused => WriteOutcome::Refused,
        Evidence::NotTransmitted => WriteOutcome::Failed,
        Evidence::Readback(Some(found)) if found == target => WriteOutcome::Verified,
        // Sent, but the tag read back as nothing or as something else: the
        // write happened and its result is unknown.
        Evidence::Readback(_) => WriteOutcome::Unverified,
        // Sent, but nothing could be read back: unknown, exactly as for a
        // read-back that reported something else.
        Evidence::ReadbackUnreadable => WriteOutcome::Unverified,
    }
}

/// Classify one *blanking* attempt, where success is the absence of an Identity.
///
/// This is deliberately not `classify` with a neutral target: `classify` would
/// compare the read-back against an Identity, and a blanked Tag has no Identity
/// to compare against. Each case is its own fact:
///
///   * nothing was transmitted → `Refused` or `Failed`, as for a copy;
///   * transmitted and the Tag presents no Identity → `Blanked`;
///   * transmitted and the Tag still presents an Identity → `Failed`, because
///     the blank did not take;
///   * transmitted but the Tag could not be read back → `Unverified`, because
///     the write may or may not have landed.
///
/// A `Blanked` outcome is never a confirmed copy: it destroys an Identity
/// rather than creating one, so it must not raise any Snapshot's count.
pub fn classify_blank(evidence: Evidence) -> WriteOutcome {
    match evidence {
        Evidence::Refused => WriteOutcome::Refused,
        Evidence::NotTransmitted => WriteOutcome::Failed,
        Evidence::Readback(None) => WriteOutcome::Blanked,
        // A Tag that still presents an Identity was not blanked. Any Identity
        // counts here, including a different one: a read-back that reports an
        // Identity at all is not a blank.
        Evidence::Readback(Some(_)) => WriteOutcome::Failed,
        Evidence::ReadbackUnreadable => WriteOutcome::Unverified,
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
    fn the_outcomes_carry_distinct_wire_names() {
        let names: Vec<&str> = [
            WriteOutcome::Refused,
            WriteOutcome::Verified,
            WriteOutcome::Blanked,
            WriteOutcome::Unverified,
            WriteOutcome::Failed,
        ]
        .iter()
        .map(|o| o.as_str())
        .collect();
        assert_eq!(
            names,
            vec!["refused", "verified", "blanked", "unverified", "failed"]
        );
    }

    // ---- blanking: success is the absence of an Identity -----------------

    #[test]
    fn a_blanked_write_is_not_a_confirmed_copy() {
        // The whole counting rule in one line: blanking destroys an Identity,
        // so it can never raise a Snapshot's count of Tags that carry it.
        assert!(!WriteOutcome::Blanked.counts_as_confirmed_copy());
    }

    #[test]
    fn a_blanked_write_is_not_unknown() {
        // A blanking write whose read-back reports nothing is a definite
        // result, not a shrug: this is the expected evidence of success.
        assert!(!WriteOutcome::Blanked.is_unknown());
    }

    #[test]
    fn a_transmitted_blank_with_no_identity_reading_is_blanked() {
        assert_eq!(
            classify_blank(Evidence::Readback(None)),
            WriteOutcome::Blanked
        );
    }

    #[test]
    fn a_transmitted_blank_that_still_presents_an_identity_failed() {
        // The blank did not take. This is a failure, not "unknown": the Tag
        // was read and it still carries a credential.
        let outcome = classify_blank(Evidence::Readback(Some(target())));
        assert_eq!(outcome, WriteOutcome::Failed);
        assert!(!outcome.counts_as_confirmed_copy());

        // A different Identity is just as much a failed blank.
        assert_eq!(
            classify_blank(Evidence::Readback(Some(other()))),
            WriteOutcome::Failed
        );
    }

    #[test]
    fn a_blanking_refusal_stays_a_refusal_and_a_lost_transmission_stays_failed() {
        assert_eq!(classify_blank(Evidence::Refused), WriteOutcome::Refused);
        assert_eq!(
            classify_blank(Evidence::NotTransmitted),
            WriteOutcome::Failed
        );
    }

    #[test]
    fn a_blank_whose_read_back_could_not_be_read_is_unknown_not_blanked() {
        // Nothing was observed after the write, so claiming the Tag is blank
        // would be a claim about a credential the app did not see.
        let outcome = classify_blank(Evidence::ReadbackUnreadable);
        assert_eq!(outcome, WriteOutcome::Unverified);
        assert!(outcome.is_unknown());
        assert!(!outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn a_copy_whose_read_back_could_not_be_read_is_unknown_too() {
        assert_eq!(
            classify(Evidence::ReadbackUnreadable, target()),
            WriteOutcome::Unverified
        );
    }
}

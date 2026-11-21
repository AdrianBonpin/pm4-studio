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
    /// The write was transmitted; this is what the Tag read back, if anything.
    Readback(Option<Identity>),
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

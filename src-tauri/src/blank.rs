//! Blanking a Tag's Identity: the guard that decides, and the verdict on what
//! one attempt turned out to be.
//!
//! Nothing here touches the Reader. Both halves are pure functions over plain
//! data, so every rule below is provable with no hardware attached — the same
//! arrangement ADR 0001 uses for the copy path.
//!
//! # What blanking is
//!
//! A blanking write sends `0x0073` with the neutral Identity
//! ([`Identity::BLANK`](crate::identity::Identity::BLANK)): no customer byte, no
//! data field. It is **not** a factory reset and it does **not** unlock a locked
//! T5577. A factory configuration is not reachable over this protocol, and a
//! chip that has stopped accepting writes stays that way.
//!
//! # Why the guard is not the copy guard
//!
//! `write_guard` refuses a copy when the Tag already presents the Identity being
//! written, because that is almost certainly the source Tag left in place. For a
//! blanking write the same reading is the *normal* case: the Tag presenting the
//! Identity is the one the user asked to blank. So the rule here is different in
//! shape but identical in spirit — fail closed on anything the app cannot see:
//!
//!   1. Nothing read in the write position (no Tag, or a reply too short to
//!      decode) → refuse. Writing blind is what locked a chip (ADR 0001).
//!   2. The Tag is there and carries no Identity already → refuse. There is
//!      nothing to blank, and a pointless write is a pointless risk.
//!   3. The Tag presents an Identity other than the one the user confirmed →
//!      refuse. The user confirmed one credential; blanking a different one
//!      would destroy something they never agreed to lose.
//!
//! The third rule is the one that needs the confirmation to be passed back into
//! the write: the Identity read for the confirmation and the Identity in front
//! of the write are compared, so confirming Tag A and blanking Tag B cannot
//! happen silently.
//!
//! # Success is the absence of a reading
//!
//! The Identity codec treats an all-zero data field as "no reading", so a
//! blanked Tag reads back as *empty* rather than as a neutral Identity. That
//! makes the success condition of a blanking write the exact case the copy path
//! calls "no reading". [`crate::write_outcome::classify_blank`] holds that
//! inversion; this module produces the evidence it judges, and words the result.
//!
//! The one thing a read-back cannot prove is that the Tag is still on the
//! Reader: a Tag that reads as empty and a Tag that was lifted off look the
//! same. `Blanked` therefore means "the Tag no longer presents an Identity",
//! which is what blanking is for, and the UI says so in those words.

use crate::identity::{Identity, TagPresence};
use crate::write_outcome::{self, Evidence, WriteOutcome};

/// What the guard decides about one attempted blanking write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlankDecision {
    /// A Tag was read, it presents exactly the Identity the user confirmed, and
    /// the write may proceed.
    Proceed,
    /// Refused: nothing could be read in the write position, so the write would
    /// be blind.
    RefuseUnreadable,
    /// Refused: the Tag is there and already carries no Identity.
    RefuseNothingToBlank,
    /// Refused: the Tag presents an Identity the user did not confirm.
    RefuseDifferentIdentity,
}

impl BlankDecision {
    /// True only for `Proceed`. Every other decision stops the write.
    pub fn allows_write(self) -> bool {
        matches!(self, BlankDecision::Proceed)
    }

    /// The refusal to show the user, or `None` when the write may proceed.
    ///
    /// `confirmed` is the Identity the user agreed to destroy, and `current` is
    /// what the Tag presented when it presented anything.
    pub fn refusal_message(self, confirmed: Identity, current: Option<Identity>) -> Option<String> {
        match self {
            BlankDecision::Proceed => None,
            BlankDecision::RefuseUnreadable => Some(
                "could not read the tag on the reader, so there is no Identity to blank and \
                 nothing was written. Put the 125 kHz tag you want to blank on the reader and \
                 read it again."
                    .to_string(),
            ),
            BlankDecision::RefuseNothingToBlank => Some(
                "the tag on the reader already carries no Identity, so there is nothing to \
                 blank and nothing was written."
                    .to_string(),
            ),
            BlankDecision::RefuseDifferentIdentity => {
                let read = current
                    .map(|c| c.id())
                    .unwrap_or_else(|| "a different tag".to_string());
                Some(format!(
                    "the tag on the reader reads as {read}, not the {} you confirmed, so nothing \
                     was written. Read the tag you want to blank again and confirm that one.",
                    confirmed.id()
                ))
            }
        }
    }
}

/// Decide whether blanking `confirmed` may proceed, given what the Tag in the
/// write position reads as.
///
/// Closed: only a Tag that presents exactly `confirmed` proceeds. `confirmed` is
/// never range-checked, because a Tag whose data field has the reserved high
/// byte set still reads and is still fair game to blank — it simply cannot be
/// written back as a copy.
pub fn decide(presence: TagPresence, confirmed: Identity) -> BlankDecision {
    match presence {
        // A reply too short to decode is not evidence that a Tag is there.
        TagPresence::Absent | TagPresence::Unreadable => BlankDecision::RefuseUnreadable,
        TagPresence::Blank => BlankDecision::RefuseNothingToBlank,
        TagPresence::Identified(read) if read == confirmed => BlankDecision::Proceed,
        TagPresence::Identified(_) => BlankDecision::RefuseDifferentIdentity,
    }
}

/// What the Tag presented when it was re-read after the blanking write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlankReadback {
    /// No Identity at all: the Tag no longer carries a credential.
    NoIdentity,
    /// The Tag still presents an Identity, so the blank did not take.
    StillIdentifies(Identity),
    /// The Tag could not be read back, so what it carries now is unknown.
    Unreadable,
}

/// What one guarded blanking attempt produced, before the read-back is judged.
///
/// A refusal means no bytes were sent; a failure means the write never reached
/// the device; a transmission carries whatever the re-read saw.
#[derive(Debug)]
pub enum BlankAttempt {
    /// Nothing was transmitted: the guard refused.
    Refused(String),
    /// The write command could not be transmitted.
    Failed(String),
    /// The write was transmitted; this is what the re-read saw.
    Transmitted(BlankReadback),
}

impl BlankAttempt {
    /// The evidence `write_outcome::classify_blank` judges. Kept as its own
    /// function so the mapping is stated once and can be tested directly.
    pub fn evidence(&self) -> Evidence {
        match self {
            BlankAttempt::Refused(_) => Evidence::Refused,
            BlankAttempt::Failed(_) => Evidence::NotTransmitted,
            BlankAttempt::Transmitted(BlankReadback::NoIdentity) => Evidence::Readback(None),
            BlankAttempt::Transmitted(BlankReadback::StillIdentifies(identity)) => {
                Evidence::Readback(Some(*identity))
            }
            BlankAttempt::Transmitted(BlankReadback::Unreadable) => Evidence::ReadbackUnreadable,
        }
    }
}

/// Accumulates the re-reads after a blanking write into a single read-back
/// result, so the rule that produces them is provable with no Reader attached.
///
/// Two things make this more than a counter:
///
///   * An Identity reading ends the scan at once. A Tag that still presents a
///     credential is the failure case, and it must never be talked out of by
///     later silence — the silence could be the Tag being lifted off.
///   * "No Identity" is only concluded after a **whole quiet window**, because
///     the firmware can take a moment after a write before it reads the Tag
///     again. One early empty reply proves nothing; eight in a row do.
///
/// A malformed reply concludes nothing in either direction: it counts towards
/// the window without filling it, so a scan made of malformed replies is
/// `Unreadable` rather than `NoIdentity`.
#[derive(Debug, Default)]
pub struct BlankScan {
    quiet_readings: usize,
    malformed_readings: usize,
}

impl BlankScan {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one re-read. `Some` means the scan is decided and the caller may
    /// stop reading.
    pub fn observe(&mut self, presence: TagPresence) -> Option<BlankReadback> {
        match presence {
            TagPresence::Identified(identity) => Some(BlankReadback::StillIdentifies(identity)),
            TagPresence::Absent | TagPresence::Blank => {
                self.quiet_readings += 1;
                None
            }
            TagPresence::Unreadable => {
                self.malformed_readings += 1;
                None
            }
        }
    }

    /// The result once `attempts` re-reads have been made: blanked only when
    /// every one of them reported no Identity. A window of zero re-reads proves
    /// nothing, so it cannot conclude a blank either.
    pub fn finish(&self, attempts: usize) -> BlankReadback {
        if attempts > 0 && self.quiet_readings >= attempts {
            BlankReadback::NoIdentity
        } else {
            BlankReadback::Unreadable
        }
    }

    /// How many re-reads reported no Identity, for the probe's log.
    pub fn quiet_readings(&self) -> usize {
        self.quiet_readings
    }

    /// How many re-reads could not be decoded at all, for the probe's log.
    pub fn malformed_readings(&self) -> usize {
        self.malformed_readings
    }
}

/// What one blanking attempt turned out to be, in the shape the UI reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlankVerdict {
    pub outcome: WriteOutcome,
    /// Why the Tag was not blanked, when it was not.
    pub message: Option<String>,
    /// What the Tag still presents, when the re-read found an Identity.
    pub still_identifies: Option<Identity>,
}

/// Judge one attempt: the outcome, the reason, and any Identity still on the Tag.
///
/// `Blanked` is reported only for a transmission whose re-read found no
/// Identity. It is never reported for a refusal, for a transmission that never
/// happened, or for a re-read that failed.
pub fn verdict(attempt: &BlankAttempt) -> BlankVerdict {
    let outcome = write_outcome::classify_blank(attempt.evidence());
    let (message, still_identifies) = match attempt {
        BlankAttempt::Refused(why) => (Some(why.clone()), None),
        BlankAttempt::Failed(why) => (Some(why.clone()), None),
        BlankAttempt::Transmitted(BlankReadback::NoIdentity) => (None, None),
        BlankAttempt::Transmitted(BlankReadback::StillIdentifies(identity)) => (
            Some(format!(
                "the tag still reads as {} after the blanking write, so it was not blanked. \
                 Nothing else was changed.",
                identity.id()
            )),
            Some(*identity),
        ),
        BlankAttempt::Transmitted(BlankReadback::Unreadable) => (
            Some(
                "the blanking write was sent, but the tag could not be read back, so whether it \
                 still carries an Identity is unknown. Read the tag on the reader to find out."
                    .to_string(),
            ),
            None,
        ),
    };
    BlankVerdict {
        outcome,
        message,
        still_identifies,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_frames;

    /// The Tag this app wrote and read back: `55 00 84 82 12`.
    fn written_tag() -> Identity {
        Identity::from_read_payload(&test_frames::payload(test_frames::LF_WRITE_READBACK))
            .expect("read-back capture decodes")
    }

    /// A different Tag: `56 00 53 C7 B3`.
    fn other_tag() -> Identity {
        Identity::from_read_payload(&test_frames::payload(test_frames::LF_READ_CARD_PRESENT))
            .expect("read capture decodes")
    }

    // ---- the guard -------------------------------------------------------

    #[test]
    fn refuses_when_no_tag_could_be_read() {
        let decision = decide(TagPresence::Absent, written_tag());
        assert_eq!(decision, BlankDecision::RefuseUnreadable);
        assert!(!decision.allows_write());
    }

    #[test]
    fn refuses_when_the_reply_was_too_short_to_decode() {
        let decision = decide(TagPresence::Unreadable, written_tag());
        assert_eq!(decision, BlankDecision::RefuseUnreadable);
        assert!(!decision.allows_write());
    }

    #[test]
    fn refuses_a_tag_that_already_carries_no_identity() {
        // Nothing to blank, and a write that cannot achieve anything is a risk
        // with no reward.
        let decision = decide(TagPresence::Blank, written_tag());
        assert_eq!(decision, BlankDecision::RefuseNothingToBlank);
        assert!(!decision.allows_write());
    }

    #[test]
    fn proceeds_when_the_tag_presents_the_identity_the_user_confirmed() {
        // The inverse of the copy guard, deliberately: the Tag presenting the
        // confirmed Identity is the one the user asked to blank.
        let decision = decide(TagPresence::Identified(written_tag()), written_tag());
        assert_eq!(decision, BlankDecision::Proceed);
        assert!(decision.allows_write());
    }

    #[test]
    fn refuses_a_tag_that_presents_an_identity_the_user_did_not_confirm() {
        // Confirming one credential and blanking another must be impossible:
        // this is the shape of destroying the wrong Tag.
        let decision = decide(TagPresence::Identified(other_tag()), written_tag());
        assert_eq!(decision, BlankDecision::RefuseDifferentIdentity);
        assert!(!decision.allows_write());
    }

    #[test]
    fn the_whole_identity_is_compared_not_just_the_customer_byte() {
        let confirmed = written_tag();
        let same_customer_other_data = Identity {
            customer: confirmed.customer,
            data32: 0x00AB_CDEF,
        };
        assert_eq!(
            decide(TagPresence::Identified(same_customer_other_data), confirmed),
            BlankDecision::RefuseDifferentIdentity
        );

        let same_data_other_customer = Identity {
            customer: 0x77,
            data32: confirmed.data32,
        };
        assert_eq!(
            decide(TagPresence::Identified(same_data_other_customer), confirmed),
            BlankDecision::RefuseDifferentIdentity
        );
    }

    #[test]
    fn a_blank_confirmation_can_never_proceed() {
        // There is no Identity to confirm when the field is empty, so a blank
        // "confirmation" must not turn into a write.
        assert!(!decide(TagPresence::Absent, Identity::BLANK).allows_write());
        assert!(!decide(TagPresence::Blank, Identity::BLANK).allows_write());
        assert!(!decide(TagPresence::Unreadable, Identity::BLANK).allows_write());
        assert!(!decide(TagPresence::Identified(written_tag()), Identity::BLANK).allows_write());
    }

    #[test]
    fn the_unreadable_refusal_says_nothing_was_written_and_why() {
        let message = BlankDecision::RefuseUnreadable
            .refusal_message(written_tag(), None)
            .expect("a refusal has a message");
        assert!(message.contains("could not read"), "{message}");
        assert!(message.contains("nothing was written"), "{message}");
    }

    #[test]
    fn the_nothing_to_blank_refusal_says_so() {
        let message = BlankDecision::RefuseNothingToBlank
            .refusal_message(written_tag(), None)
            .expect("a refusal has a message");
        assert!(message.contains("already carries no Identity"), "{message}");
        assert!(message.contains("nothing was written"), "{message}");
    }

    #[test]
    fn the_different_identity_refusal_names_both_identities() {
        let message = BlankDecision::RefuseDifferentIdentity
            .refusal_message(written_tag(), Some(other_tag()))
            .expect("a refusal has a message");
        assert!(
            message.contains("56 00 53 C7 B3"),
            "what it read: {message}"
        );
        assert!(
            message.contains("55 00 84 82 12"),
            "what was confirmed: {message}"
        );
    }

    #[test]
    fn a_proceeding_decision_has_no_refusal_message() {
        assert_eq!(
            BlankDecision::Proceed.refusal_message(written_tag(), Some(written_tag())),
            None
        );
    }

    // ---- the verdict -----------------------------------------------------

    #[test]
    fn a_transmitted_blank_with_no_readback_identity_is_blanked() {
        let verdict = verdict(&BlankAttempt::Transmitted(BlankReadback::NoIdentity));
        assert_eq!(verdict.outcome, WriteOutcome::Blanked);
        assert_eq!(verdict.message, None);
        assert!(!verdict.outcome.counts_as_confirmed_copy());
        assert!(!verdict.outcome.is_unknown());
    }

    #[test]
    fn a_transmitted_blank_that_still_reads_is_failed_and_names_the_identity() {
        let verdict = verdict(&BlankAttempt::Transmitted(BlankReadback::StillIdentifies(
            written_tag(),
        )));
        assert_eq!(verdict.outcome, WriteOutcome::Failed);
        assert_eq!(verdict.still_identifies, Some(written_tag()));
        let message = verdict.message.expect("a failure has a message");
        assert!(
            message.contains("still reads as 55 00 84 82 12"),
            "{message}"
        );
        assert!(message.contains("not blanked"), "{message}");
        assert!(!verdict.outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn a_blank_whose_readback_failed_is_unverified_not_blanked() {
        let verdict = verdict(&BlankAttempt::Transmitted(BlankReadback::Unreadable));
        assert_eq!(verdict.outcome, WriteOutcome::Unverified);
        assert!(verdict.outcome.is_unknown());
        let message = verdict.message.expect("an unknown result says so");
        assert!(message.contains("could not be read back"), "{message}");
        assert!(message.contains("unknown"), "{message}");
    }

    #[test]
    fn a_refusal_is_reported_as_the_guard_worded_it() {
        let verdict = verdict(&BlankAttempt::Refused("stop".to_string()));
        assert_eq!(verdict.outcome, WriteOutcome::Refused);
        assert_eq!(verdict.message.as_deref(), Some("stop"));
        assert!(!verdict.outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn a_transmission_that_never_happened_is_failed() {
        let verdict = verdict(&BlankAttempt::Failed("USB write failed".to_string()));
        assert_eq!(verdict.outcome, WriteOutcome::Failed);
        assert_eq!(verdict.message.as_deref(), Some("USB write failed"));
    }

    #[test]
    fn nothing_but_a_witnessed_absence_of_identity_is_blanked() {
        // The whole honesty requirement in one assertion: only one attempt shape
        // out of five may claim the Tag was blanked.
        let attempts = [
            BlankAttempt::Refused("stop".to_string()),
            BlankAttempt::Failed("no device".to_string()),
            BlankAttempt::Transmitted(BlankReadback::Unreadable),
            BlankAttempt::Transmitted(BlankReadback::StillIdentifies(other_tag())),
        ];
        for attempt in attempts {
            assert_ne!(
                verdict(&attempt).outcome,
                WriteOutcome::Blanked,
                "{attempt:?} must not claim a blank"
            );
        }
    }

    // ---- the re-read scan ------------------------------------------------

    #[test]
    fn a_whole_quiet_window_is_the_only_way_to_conclude_a_blank() {
        let mut scan = BlankScan::new();
        for _ in 0..8 {
            assert_eq!(scan.observe(TagPresence::Absent), None);
        }
        assert_eq!(scan.finish(8), BlankReadback::NoIdentity);
        assert_eq!(scan.quiet_readings(), 8);
    }

    #[test]
    fn one_empty_reply_is_not_a_blank() {
        // The firmware can need a moment after a write; an early empty reply is
        // not evidence, which is why the scan waits for the whole window.
        let mut scan = BlankScan::new();
        scan.observe(TagPresence::Absent);
        assert_eq!(scan.finish(8), BlankReadback::Unreadable);
    }

    #[test]
    fn a_tag_that_still_presents_an_identity_ends_the_scan_at_once() {
        let mut scan = BlankScan::new();
        assert_eq!(scan.observe(TagPresence::Absent), None);
        assert_eq!(
            scan.observe(TagPresence::Identified(written_tag())),
            Some(BlankReadback::StillIdentifies(written_tag()))
        );
    }

    #[test]
    fn a_present_tag_with_an_empty_data_field_also_counts_as_a_quiet_reading() {
        // Both shapes mean "no Identity is presented", and both are what a
        // blanked Tag may look like depending on the firmware.
        let mut scan = BlankScan::new();
        for _ in 0..8 {
            scan.observe(TagPresence::Blank);
        }
        assert_eq!(scan.finish(8), BlankReadback::NoIdentity);
    }

    #[test]
    fn a_window_of_no_reads_proves_nothing() {
        let scan = BlankScan::new();
        assert_eq!(scan.finish(0), BlankReadback::Unreadable);
    }

    #[test]
    fn a_malformed_reply_concludes_nothing_either_way() {
        let mut scan = BlankScan::new();
        for _ in 0..7 {
            scan.observe(TagPresence::Absent);
        }
        scan.observe(TagPresence::Unreadable);
        assert_eq!(scan.finish(8), BlankReadback::Unreadable);
        assert_eq!(scan.malformed_readings(), 1);
    }
}

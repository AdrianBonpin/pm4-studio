//! The two operations that overwrite a Tag's Identity — **Clear** and
//! **Destroy** — with the guard that decides, the accumulated read-back, and the
//! verdict on what one attempt turned out to be.
//!
//! Nothing here touches the Reader. Both halves are pure functions over plain
//! data, so every rule below is provable with no hardware attached — the same
//! arrangement ADR 0001 uses for the copy path.
//!
//! # Two operations, not one
//!
//! **Clear** writes the non-zero placeholder Identity
//! ([`Identity::CLEARED`](crate::identity::Identity::CLEARED)). The Tag stops
//! being a working credential — no building system issues that number — and it
//! stays a live, rewritable chip: it still reads as a Tag, so it is a legal write
//! position for the next Clone or authored Identity.
//!
//! **Destroy** writes the neutral Identity ([`Identity::BLANK`]), the operation
//! this app used to offer as its routine one. Measured on hardware 2026-11-22,
//! three times and once after a field re-seat: a T5577 written with that payload
//! stops presenting an Identity, keeps latching and modulating so every reader
//! still reaches it, and permanently refuses further data. It is not a factory
//! reset and it does not unlock anything; the chip is gone as a writable Tag.
//!
//! The two are separate operations because the two things a person wants are
//! genuinely different. "This fob should stop opening the door and I want the tag
//! back" is routine; "this fob must never open anything again" is rare and
//! destructive. One operation cannot be both, and presenting the destructive one
//! as the routine one is how three tags were consumed.
//!
//! # Why Clear's payload is clone-shaped
//!
//! Clear's safety argument is not "the value is non-zero, therefore it is fine".
//! It is the payload's **shape**: customer at `[8]` and `[12]`, data32 at
//! `[16..20]`, in the 24-byte `0x0073` layout [`Identity::write_payload`]
//! produces. That is the same layout this app writes on every routine Clone, and
//! clone writes have never locked a chip. The all-zero payload is the one payload
//! no clone ever writes, and it is the one that locked three chips. The payload
//! shape is evidence; a hardware confirmation on a fresh chip is not, and none is
//! available (see the ticket).
//!
//! # Why the guard is not the copy guard
//!
//! `write_guard` refuses a copy when the Tag already presents the Identity being
//! written, because that is almost certainly the source Tag left in place. Here
//! the same reading is the *normal* case: the Tag presenting the Identity is the
//! one the user asked to overwrite. So the rule is different in shape but
//! identical in spirit — fail closed on anything the app cannot see:
//!
//!   1. Nothing read in the write position (no Tag, or a reply too short to
//!      decode) → refuse. Writing blind is what locked a chip (ADR 0001).
//!   2. The Tag is there and presents an Identity other than the one the user
//!      confirmed → refuse. The user confirmed one credential; overwriting a
//!      different one would destroy something they never agreed to lose.
//!   3. Destroy, and the Tag already carries no Identity → refuse. There is
//!      nothing to destroy, and a pointless write is a pointless risk.
//!
//! Clear is deliberately *not* refused by rule 3. A Tag that reads as carrying no
//! Identity has nothing of the user's to lose, and Clear has something to achieve
//! on it: put the placeholder on a chip that has no value. That makes Clear the
//! only attempt this app can make at a Tag someone else left empty, and it is the
//! same reading `write_guard` already treats as a legal write position.
//!
//! Rule 2 is the one that needs the confirmation passed back into the write: the
//! Identity read for the confirmation and the Identity in front of the write are
//! compared, so confirming Tag A and overwriting Tag B cannot happen silently.
//!
//! # Success is different for each, and so is the read-back
//!
//! Clear aims at a value, so its read-back is the ordinary kind: the Tag presents
//! exactly the placeholder, or it does not. Destroy exists to produce an absence,
//! and the Identity codec treats an all-zero data field as "no reading", so its
//! success condition is the exact case the copy path calls "no reading".
//! [`crate::write_outcome::classify_clear`] and
//! [`crate::write_outcome::classify_destroy`] hold those two judgments; this
//! module produces the evidence they judge, and words the result.
//!
//! The one thing a read-back cannot prove is that the Tag is still on the Reader:
//! a Tag that reads as carrying nothing and a Tag that was lifted off look the
//! same. `Destroyed` therefore means "the Tag no longer presents an Identity",
//! which is what destroying does, and the UI says so in those words.
//!
//! # Two refusals that are not the same refusal
//!
//! A destroying attempt that found nothing to destroy and a destroying write the
//! chip would not take are different facts, and only one of them is a report about
//! the chip:
//!
//!   * [`ClearDecision::RefuseNothingToDestroy`] — the Tag is there and already
//!     carries no Identity. **Nothing is transmitted**, so nothing was learned
//!     about whether the chip accepts writes.
//!   * [`WriteOutcome::WillNotAcceptWrites`] — a write *was* sent and the re-read
//!     still found an Identity (or, for a clear, did not find the placeholder).
//!     That is evidence about the chip: it kept what it had. Only a transmission
//!     can produce it (ADR 0007).

use crate::identity::{Identity, TagPresence};
use crate::write_outcome::{self, Evidence, WriteOutcome};

/// Which of the two operations the user asked for.
///
/// The value travels from the interface to the write, so the payload is chosen in
/// one place rather than at each call site, and so a verdict can be worded for the
/// operation the user actually chose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LfOperation {
    /// Write the non-zero placeholder: the Tag stops being a credential and stays
    /// a live, rewritable chip.
    Clear,
    /// Write the neutral Identity: the Tag stops presenting an Identity and
    /// permanently refuses further data.
    Destroy,
}

impl LfOperation {
    /// The stable wire name the interface sends and switches on.
    pub fn as_str(self) -> &'static str {
        match self {
            LfOperation::Clear => "clear",
            LfOperation::Destroy => "destroy",
        }
    }

    /// Parse the wire name. Closed: an unknown name is an error rather than a
    /// default, because the default here is an irreversible write.
    pub fn from_wire(name: &str) -> Result<Self, String> {
        match name {
            "clear" => Ok(LfOperation::Clear),
            "destroy" => Ok(LfOperation::Destroy),
            other => Err(format!(
                "unknown tag operation {other:?}: expected \"clear\" or \"destroy\""
            )),
        }
    }

    /// The payload this operation writes. The only place either value is chosen.
    pub fn payload(self) -> Identity {
        match self {
            LfOperation::Clear => Identity::CLEARED,
            LfOperation::Destroy => Identity::BLANK,
        }
    }

    /// The verb for a sentence about what the user did.
    pub fn verb(self) -> &'static str {
        match self {
            LfOperation::Clear => "clear",
            LfOperation::Destroy => "destroy",
        }
    }

    /// The verb in the past tense, for "it was not ___".
    pub fn past(self) -> &'static str {
        match self {
            LfOperation::Clear => "cleared",
            LfOperation::Destroy => "destroyed",
        }
    }
}

/// What the guard decides about one attempted overwrite.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClearDecision {
    /// A Tag was read, it presents exactly the Identity the user confirmed, and
    /// the write may proceed. Also what Clear decides on a Tag that carries no
    /// Identity: there is nothing to lose and a value to give it.
    Proceed,
    /// Refused: nothing could be read in the write position, so the write would
    /// be blind.
    RefuseUnreadable,
    /// Refused: Destroy was asked for, and the Tag is there carrying no Identity.
    ///
    /// Nothing was transmitted, so this is not [`WriteOutcome::WillNotAcceptWrites`]:
    /// that outcome is a report about the chip, and it requires a write to have
    /// been attempted. This one means the attempt was pointless, not that it was
    /// turned down.
    RefuseNothingToDestroy,
    /// Refused: the Tag presents an Identity the user did not confirm.
    RefuseDifferentIdentity,
}

impl ClearDecision {
    /// True only for `Proceed`. Every other decision stops the write.
    pub fn allows_write(self) -> bool {
        matches!(self, ClearDecision::Proceed)
    }

    /// The refusal to show the user, or `None` when the write may proceed.
    ///
    /// `confirmed` is the Identity the user agreed to overwrite, `current` is what
    /// the Tag presented when it presented anything, and `operation` is what the
    /// user asked for — the refusal says the word for the thing they tried.
    pub fn refusal_message(
        self,
        operation: LfOperation,
        confirmed: Identity,
        current: Option<Identity>,
    ) -> Option<String> {
        let verb = operation.verb();
        match self {
            ClearDecision::Proceed => None,
            ClearDecision::RefuseUnreadable => Some(format!(
                "could not read the tag on the reader, so there is no Identity to {verb} and \
                 nothing was written. Put the 125 kHz tag you want to {verb} on the reader and \
                 read it again."
            )),
            ClearDecision::RefuseNothingToDestroy => Some(
                "the tag on the reader already carries no Identity, so there is nothing to \
                 destroy and nothing was written. The tag is still on the reader; a tag may still \
                 refuse every write, and this Reader cannot tell without writing to it. Whether to \
                 try any write on it is your decision, not something this app can check."
                    .to_string(),
            ),
            ClearDecision::RefuseDifferentIdentity => {
                let read = current
                    .map(|c| c.id())
                    .unwrap_or_else(|| "a different tag".to_string());
                Some(format!(
                    "the tag on the reader reads as {read}, not the {} you confirmed, so nothing \
                     was written. Read the tag you want to {verb} again and confirm that one.",
                    confirmed.id()
                ))
            }
        }
    }
}

/// Decide whether overwriting `confirmed` with `operation`'s payload may proceed,
/// given what the Tag in the write position reads as.
///
/// Closed: only a Tag that presents exactly `confirmed` proceeds, and — for Clear
/// only — a Tag that is present carrying no Identity at all. `confirmed` is never
/// range-checked, because a Tag whose data field has the reserved high byte set
/// still reads and is still fair game to overwrite.
pub fn decide(presence: TagPresence, confirmed: Identity, operation: LfOperation) -> ClearDecision {
    match presence {
        // A reply too short to decode is not evidence that a Tag is there.
        TagPresence::Absent | TagPresence::Unreadable => ClearDecision::RefuseUnreadable,
        // A Tag with no Identity has nothing of the user's to lose, so Clear has
        // something to give it. Destroy has nothing to remove — and a write that
        // cannot achieve anything is a risk with no reward.
        TagPresence::Blank => match operation {
            LfOperation::Clear => ClearDecision::Proceed,
            LfOperation::Destroy => ClearDecision::RefuseNothingToDestroy,
        },
        TagPresence::Identified(read) if read == confirmed => ClearDecision::Proceed,
        TagPresence::Identified(_) => ClearDecision::RefuseDifferentIdentity,
    }
}

/// What the Tag presented when it was re-read after the write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClearReadback {
    /// No Identity at all: the Tag no longer carries a credential.
    NoIdentity,
    /// The Tag presents an Identity: the placeholder when a Clear landed, and
    /// whatever it kept when it did not.
    Presents(Identity),
    /// The Tag could not be read back, so what it carries now is unknown.
    Unreadable,
}

/// What one guarded overwrite produced, before the read-back is judged.
///
/// A refusal means no bytes were sent; a failure means the write never reached
/// the device; a transmission carries whatever the re-read saw.
#[derive(Debug)]
pub enum ClearAttempt {
    /// Nothing was transmitted: the guard refused.
    Refused(String),
    /// The write command could not be transmitted.
    Failed(String),
    /// The write was transmitted; this is what the re-read saw.
    Transmitted(ClearReadback),
}

impl ClearAttempt {
    /// The evidence the classifier judges. Kept as its own function so the
    /// mapping is stated once and can be tested directly.
    pub fn evidence(&self) -> Evidence {
        match self {
            ClearAttempt::Refused(_) => Evidence::Refused,
            ClearAttempt::Failed(_) => Evidence::NotTransmitted,
            ClearAttempt::Transmitted(ClearReadback::NoIdentity) => Evidence::Readback(None),
            ClearAttempt::Transmitted(ClearReadback::Presents(identity)) => {
                Evidence::Readback(Some(*identity))
            }
            ClearAttempt::Transmitted(ClearReadback::Unreadable) => Evidence::ReadbackUnreadable,
        }
    }
}

/// Accumulates the re-reads after a write into a single read-back result, so the
/// rule that produces them is provable with no Reader attached.
///
/// Two things make this more than a counter:
///
///   * An Identity reading ends the scan at once. A Tag that still presents a
///     credential is either a Clear that landed (when it is the placeholder) or a
///     write that did not take, and neither may be talked out of by later silence
///     — the silence could be the Tag being lifted off.
///   * "No Identity" is only concluded after a **whole quiet window**, because the
///     firmware can take a moment after a write before it reads the Tag again. One
///     early empty reply proves nothing; eight in a row do.
///
/// A malformed reply concludes nothing in either direction: it counts towards the
/// window without filling it, so a scan made of malformed replies is `Unreadable`
/// rather than `NoIdentity`.
#[derive(Debug, Default)]
pub struct ClearScan {
    quiet_readings: usize,
    malformed_readings: usize,
    presented: Option<Identity>,
}

impl ClearScan {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one re-read. `Some` means the scan is decided and the caller may stop
    /// reading.
    pub fn observe(&mut self, presence: TagPresence) -> Option<ClearReadback> {
        match presence {
            TagPresence::Identified(identity) => {
                self.presented = Some(identity);
                Some(ClearReadback::Presents(identity))
            }
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

    /// The result once `attempts` re-reads have been made: no Identity is only
    /// concluded when every one of them reported none. A window of zero re-reads
    /// proves nothing, so it cannot conclude anything either.
    pub fn finish(&self, attempts: usize) -> ClearReadback {
        if let Some(identity) = self.presented {
            ClearReadback::Presents(identity)
        } else if attempts > 0 && self.quiet_readings >= attempts {
            ClearReadback::NoIdentity
        } else {
            ClearReadback::Unreadable
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

/// What one attempt turned out to be, in the shape the UI reads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClearVerdict {
    pub outcome: WriteOutcome,
    /// Why the Tag was not overwritten as asked, when it was not.
    pub message: Option<String>,
    /// What the Tag presents, when the re-read found an Identity: the placeholder
    /// after a Clear that landed, and what it kept when the write did not take.
    pub presented: Option<Identity>,
}

/// The cause sentence both "will not accept writes" messages share.
///
/// Stated as possibilities because that is what they are: the Reader cannot tell a
/// locked chip from one that was never writable, and claiming one would be
/// inventing a finding. It is also where the app says no pre-check could have
/// helped, so a user does not go looking for one — or ask for one (ADR 0007).
const WILL_NOT_ACCEPT_WRITES_CAUSE: &str =
    "The likely cause is that the tag has already been written once — a T5577 that has been \
     written may permanently refuse further writes — or that it was never writable. This Reader \
     cannot tell which it is, and no check exists that could have told you first: a writability \
     test is a write, so this attempt was the only way to find out. Nothing else about the tag \
     was changed.";

/// Judge one attempt for the operation the user chose: the outcome, the reason,
/// and any Identity the Tag still presents.
///
/// The outcome comes from [`write_outcome::classify_clear`] or
/// [`write_outcome::classify_destroy`] — never from a value this function picks —
/// so a Clear can never be reported as a Destroy or the other way round.
///
/// A refusal stays `Refused`. In particular a Destroy on a Tag that already
/// carries no Identity is refused before anything is sent, so it can never reach
/// `WillNotAcceptWrites`: nothing about that chip was tested.
pub fn verdict(operation: LfOperation, attempt: &ClearAttempt) -> ClearVerdict {
    let outcome = match operation {
        LfOperation::Clear => write_outcome::classify_clear(attempt.evidence()),
        LfOperation::Destroy => write_outcome::classify_destroy(attempt.evidence()),
    };
    let (message, presented) = match attempt {
        ClearAttempt::Refused(why) => (Some(why.clone()), None),
        ClearAttempt::Failed(why) => (Some(why.clone()), None),
        ClearAttempt::Transmitted(ClearReadback::NoIdentity) => match operation {
            // The absence of an Identity is exactly what a destroy asked for.
            LfOperation::Destroy => (None, None),
            // A clear asked for a value, so an empty reading is a write that did
            // not land — and saying so is a fact about the chip (ADR 0007), not a
            // generic failure.
            LfOperation::Clear => (
                Some(format!(
                    "the tag reads as carrying no Identity after the clearing write, not the \
                     placeholder, so it was not cleared and this tag will not accept writes. \
                     {WILL_NOT_ACCEPT_WRITES_CAUSE}"
                )),
                None,
            ),
        },
        ClearAttempt::Transmitted(ClearReadback::Presents(identity)) => {
            // A Clear that found the placeholder is a Clear that landed: the
            // positive read-back a clear is judged by, so it has no message.
            if operation == LfOperation::Clear && *identity == Identity::CLEARED {
                (None, Some(*identity))
            } else {
                (
                    Some(format!(
                        "the tag still reads as {identity} after the {verb}ing write, so it was \
                         not {past} and this tag will not accept writes. \
                         {WILL_NOT_ACCEPT_WRITES_CAUSE}",
                        identity = identity.id(),
                        verb = operation.verb(),
                        past = operation.past(),
                    )),
                    Some(*identity),
                )
            }
        }
        ClearAttempt::Transmitted(ClearReadback::Unreadable) => (
            Some(format!(
                "the {verb}ing write was sent, but the tag could not be read back, so whether it \
                 {carries} is unknown. Read the tag on the reader to find out.",
                verb = operation.verb(),
                carries = match operation {
                    LfOperation::Clear => "carries the placeholder",
                    LfOperation::Destroy => "still carries an Identity",
                },
            )),
            None,
        ),
    };
    ClearVerdict {
        outcome,
        message,
        presented,
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

    // ---- the two payloads ------------------------------------------------

    #[test]
    fn the_two_operations_write_two_different_payloads() {
        // The whole split, at the one place a payload is chosen.
        assert_eq!(LfOperation::Clear.payload(), Identity::CLEARED);
        assert_eq!(LfOperation::Destroy.payload(), Identity::BLANK);
        assert_ne!(LfOperation::Clear.payload(), LfOperation::Destroy.payload());
        assert_eq!(LfOperation::Clear.as_str(), "clear");
        assert_eq!(LfOperation::Destroy.as_str(), "destroy");
    }

    #[test]
    fn the_wire_name_is_closed_and_an_unknown_one_is_refused() {
        // The default here is an irreversible write, so an unknown name is an
        // error rather than a fallback.
        assert_eq!(LfOperation::from_wire("clear"), Ok(LfOperation::Clear));
        assert_eq!(LfOperation::from_wire("destroy"), Ok(LfOperation::Destroy));
        for bad in ["", "Clear ", "wipe", "reset"] {
            assert!(
                LfOperation::from_wire(bad).is_err(),
                "{bad:?} must not parse"
            );
        }
    }

    // ---- the guard -------------------------------------------------------

    #[test]
    fn refuses_when_no_tag_could_be_read() {
        for operation in [LfOperation::Clear, LfOperation::Destroy] {
            let decision = decide(TagPresence::Absent, written_tag(), operation);
            assert_eq!(decision, ClearDecision::RefuseUnreadable);
            assert!(!decision.allows_write());
        }
    }

    #[test]
    fn refuses_when_the_reply_was_too_short_to_decode() {
        for operation in [LfOperation::Clear, LfOperation::Destroy] {
            let decision = decide(TagPresence::Unreadable, written_tag(), operation);
            assert_eq!(decision, ClearDecision::RefuseUnreadable);
            assert!(!decision.allows_write());
        }
    }

    #[test]
    fn destroy_refuses_a_tag_that_already_carries_no_identity() {
        // Nothing to destroy, and a write that cannot achieve anything is a risk
        // with no reward.
        let decision = decide(TagPresence::Blank, written_tag(), LfOperation::Destroy);
        assert_eq!(decision, ClearDecision::RefuseNothingToDestroy);
        assert!(!decision.allows_write());
    }

    #[test]
    fn clear_proceeds_on_a_tag_that_carries_no_identity() {
        // Clear has something to give this Tag — the placeholder — and nothing of
        // the user's to lose. Refusing it would leave the app with no attempt at
        // all on a chip someone else left empty, and `write_guard` already treats
        // a present Tag with no Identity as a legal write position.
        let decision = decide(TagPresence::Blank, written_tag(), LfOperation::Clear);
        assert_eq!(decision, ClearDecision::Proceed);
        assert!(decision.allows_write());
    }

    #[test]
    fn proceeds_when_the_tag_presents_the_identity_the_user_confirmed() {
        // The inverse of the copy guard, deliberately: the Tag presenting the
        // confirmed Identity is the one the user asked to overwrite.
        for operation in [LfOperation::Clear, LfOperation::Destroy] {
            let decision = decide(TagPresence::Identified(written_tag()), written_tag(), operation);
            assert_eq!(decision, ClearDecision::Proceed);
            assert!(decision.allows_write());
        }
    }

    #[test]
    fn a_cleared_tag_can_be_cleared_again() {
        // The requirement in one test: the user reads the tag, sees the
        // placeholder, confirms it, and the same operation runs again with no
        // read-before-write refusal. The confirmation is built from the reading,
        // so the Tag presents exactly what was confirmed.
        let cleared = Identity::from_read_payload(&{
            let mut payload = [0u8; crate::identity::LF_READ_PAYLOAD_LEN];
            payload[2] = 0x01;
            payload[8] = Identity::CLEARED.customer;
            payload[12..16].copy_from_slice(&Identity::CLEARED.data32.to_le_bytes());
            payload
        })
        .expect("a cleared tag reads as an Identity");

        assert_eq!(cleared, Identity::CLEARED);
        let decision = decide(TagPresence::Identified(cleared), cleared, LfOperation::Clear);
        assert_eq!(decision, ClearDecision::Proceed);
    }

    #[test]
    fn a_cleared_tag_can_be_rewritten_and_cleared_again_from_the_app() {
        // The user's requirement in their own words: a cleared tag must "have the
        // ability to be rewritten". Both routes are proved at the pure seams, with
        // no read-before-write refusal anywhere:
        //
        //   1. Clear again: the user reads the tag (it reads as the placeholder),
        //      confirms what was read, and the guard proceeds because the Tag
        //      presents exactly the confirmed Identity.
        //   2. Write a real Identity onto it: the cleared Tag is a legal write
        //      position for the copy guard, because it reads as an Identity and
        //      that Identity is not the one being written.
        let cleared = Identity::CLEARED;

        let again = decide(TagPresence::Identified(cleared), cleared, LfOperation::Clear);
        assert_eq!(again, ClearDecision::Proceed);
        assert!(again.allows_write());

        let target = written_tag();
        let as_write_position =
            crate::write_guard::decide(TagPresence::Identified(cleared), target);
        assert_eq!(as_write_position, crate::write_guard::WriteDecision::Proceed);
        assert!(as_write_position.allows_write());
        assert_eq!(
            crate::write_guard::RefusalCause::of(as_write_position),
            None,
            "there must be no read-before-write refusal on a cleared tag"
        );

        // A cleared Tag is also a legal position for a Destroy, if the user changes
        // their mind about the same chip — still no refusal, and still its own
        // operation.
        assert_eq!(
            decide(TagPresence::Identified(cleared), cleared, LfOperation::Destroy),
            ClearDecision::Proceed
        );
    }

    #[test]
    fn refuses_a_tag_that_presents_an_identity_the_user_did_not_confirm() {
        // Confirming one credential and overwriting another must be impossible:
        // this is the shape of destroying the wrong Tag.
        for operation in [LfOperation::Clear, LfOperation::Destroy] {
            let decision = decide(TagPresence::Identified(other_tag()), written_tag(), operation);
            assert_eq!(decision, ClearDecision::RefuseDifferentIdentity);
            assert!(!decision.allows_write());
        }
    }

    #[test]
    fn the_whole_identity_is_compared_not_just_the_customer_byte() {
        let confirmed = written_tag();
        let same_customer_other_data = Identity {
            customer: confirmed.customer,
            data32: 0x00AB_CDEF,
        };
        assert_eq!(
            decide(
                TagPresence::Identified(same_customer_other_data),
                confirmed,
                LfOperation::Clear
            ),
            ClearDecision::RefuseDifferentIdentity
        );

        let same_data_other_customer = Identity {
            customer: 0x77,
            data32: confirmed.data32,
        };
        assert_eq!(
            decide(
                TagPresence::Identified(same_data_other_customer),
                confirmed,
                LfOperation::Clear
            ),
            ClearDecision::RefuseDifferentIdentity
        );
    }

    #[test]
    fn a_confirmation_of_nothing_never_proceeds_on_a_tag_the_app_cannot_see() {
        // There is no Identity to confirm when the field is empty, so a blank
        // "confirmation" must not turn into a write to a field the app cannot see
        // — or to a Tag presenting something the user never agreed to overwrite.
        for operation in [LfOperation::Clear, LfOperation::Destroy] {
            assert!(!decide(TagPresence::Absent, Identity::BLANK, operation).allows_write());
            assert!(!decide(TagPresence::Unreadable, Identity::BLANK, operation).allows_write());
            assert!(!decide(
                TagPresence::Identified(written_tag()),
                Identity::BLANK,
                operation
            )
            .allows_write());
        }
    }

    #[test]
    fn only_clear_can_proceed_on_a_tag_that_carries_no_identity() {
        // The asymmetry, stated so a later edit cannot flatten it by accident.
        // Clear has a value to give a Tag with no Identity, so refusing would
        // leave the app with no attempt at all on such a chip; Destroy has nothing
        // to remove, so the same reading is a refusal. This is also why the old
        // blanket assertion "a blank confirmation can never proceed" no longer
        // holds: it encoded the single destructive operation, where a Tag with no
        // Identity was always a pointless write.
        assert!(decide(TagPresence::Blank, Identity::BLANK, LfOperation::Clear).allows_write());
        assert_eq!(
            decide(TagPresence::Blank, Identity::BLANK, LfOperation::Destroy),
            ClearDecision::RefuseNothingToDestroy
        );
    }

    #[test]
    fn the_unreadable_refusal_says_nothing_was_written_and_why() {
        let message = ClearDecision::RefuseUnreadable
            .refusal_message(LfOperation::Clear, written_tag(), None)
            .expect("a refusal has a message");
        assert!(message.contains("could not read"), "{message}");
        assert!(message.contains("nothing was written"), "{message}");
        assert!(message.contains("to clear"), "{message}");
    }

    #[test]
    fn the_nothing_to_destroy_refusal_says_so_in_destroys_words() {
        let message = ClearDecision::RefuseNothingToDestroy
            .refusal_message(LfOperation::Destroy, written_tag(), None)
            .expect("a refusal has a message");
        assert!(message.contains("nothing to destroy"), "{message}");
        assert!(message.contains("nothing was written"), "{message}");
        // The one true thing the app can add: the tag is still there, and whether
        // it takes a new Identity is the chip's answer, not this app's promise.
        assert!(message.contains("still on the reader"), "{message}");
        // The refusal never becomes a factory-restore claim.
        assert!(!message.contains("restore"), "{message}");
        assert!(!message.contains("unlock"), "{message}");
    }

    #[test]
    fn a_second_destroy_of_a_destroyed_tag_is_a_refusal_not_a_verdict_on_the_chip() {
        // The Tag this app destroyed is still there and reads as carrying no
        // Identity, so a second Destroy is refused before anything is sent. That is
        // `Refused`, and it is deliberately not `WillNotAcceptWrites`: nothing
        // about the chip was tested, so nothing about the chip may be claimed.
        let refusal = ClearDecision::RefuseNothingToDestroy
            .refusal_message(LfOperation::Destroy, written_tag(), None)
            .expect("a refusal has a message");
        let verdict = verdict(LfOperation::Destroy, &ClearAttempt::Refused(refusal));
        assert_eq!(verdict.outcome, WriteOutcome::Refused);
        assert_ne!(verdict.outcome, WriteOutcome::WillNotAcceptWrites);
        assert_eq!(verdict.presented, None);
        assert!(!verdict.outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn only_a_transmitted_write_can_say_the_chip_will_not_accept_writes() {
        // The two refusals, side by side: one is a Tag with nothing to destroy
        // (no bytes sent), the other is a chip that kept its Identity after a
        // write (bytes sent). Only the second is evidence about the chip.
        let nothing_to_destroy = verdict(
            LfOperation::Destroy,
            &ClearAttempt::Refused(
                ClearDecision::RefuseNothingToDestroy
                    .refusal_message(LfOperation::Destroy, written_tag(), None)
                    .expect("a refusal has a message"),
            ),
        );
        let kept_its_identity = verdict(
            LfOperation::Destroy,
            &ClearAttempt::Transmitted(ClearReadback::Presents(written_tag())),
        );
        assert_eq!(nothing_to_destroy.outcome, WriteOutcome::Refused);
        assert_eq!(kept_its_identity.outcome, WriteOutcome::WillNotAcceptWrites);
        assert_ne!(nothing_to_destroy.outcome, kept_its_identity.outcome);
    }

    #[test]
    fn the_different_identity_refusal_names_both_identities() {
        let message = ClearDecision::RefuseDifferentIdentity
            .refusal_message(LfOperation::Clear, written_tag(), Some(other_tag()))
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
            ClearDecision::Proceed.refusal_message(
                LfOperation::Clear,
                written_tag(),
                Some(written_tag())
            ),
            None
        );
    }

    // ---- the verdict -----------------------------------------------------

    #[test]
    fn a_clear_whose_readback_presents_the_placeholder_is_cleared() {
        let verdict = verdict(
            LfOperation::Clear,
            &ClearAttempt::Transmitted(ClearReadback::Presents(Identity::CLEARED)),
        );
        assert_eq!(verdict.outcome, WriteOutcome::Cleared);
        assert_eq!(verdict.message, None);
        assert_eq!(verdict.presented, Some(Identity::CLEARED));
        assert!(!verdict.outcome.counts_as_confirmed_copy());
        assert!(!verdict.outcome.is_unknown());
    }

    #[test]
    fn a_clear_that_left_the_tag_empty_does_not_claim_a_clear() {
        // Clear aims at a value. An empty read-back is a write that did not land,
        // and it is worded as a fact about the chip rather than as a success.
        let verdict = verdict(
            LfOperation::Clear,
            &ClearAttempt::Transmitted(ClearReadback::NoIdentity),
        );
        assert_eq!(verdict.outcome, WriteOutcome::WillNotAcceptWrites);
        assert_ne!(verdict.outcome, WriteOutcome::Cleared);
        assert_eq!(verdict.presented, None);
        let message = verdict.message.expect("a refusal has a message");
        assert!(message.contains("not the placeholder"), "{message}");
        assert!(message.contains("will not accept writes"), "{message}");
    }

    #[test]
    fn a_destroy_whose_readback_presents_no_identity_is_destroyed() {
        let verdict = verdict(
            LfOperation::Destroy,
            &ClearAttempt::Transmitted(ClearReadback::NoIdentity),
        );
        assert_eq!(verdict.outcome, WriteOutcome::Destroyed);
        assert_eq!(verdict.message, None);
        assert_eq!(verdict.presented, None);
        assert!(!verdict.outcome.counts_as_confirmed_copy());
        assert!(!verdict.outcome.is_unknown());
    }

    #[test]
    fn a_destroy_that_still_reads_will_not_accept_writes() {
        // The re-read found an Identity, so the write did not take. That is a
        // report about the chip, and it is neither a generic failure nor an
        // unknown (ADR 0007).
        let verdict = verdict(
            LfOperation::Destroy,
            &ClearAttempt::Transmitted(ClearReadback::Presents(written_tag())),
        );
        assert_eq!(verdict.outcome, WriteOutcome::WillNotAcceptWrites);
        assert_ne!(verdict.outcome, WriteOutcome::Failed);
        assert_ne!(verdict.outcome, WriteOutcome::Unverified);
        assert_eq!(verdict.presented, Some(written_tag()));
        assert!(!verdict.outcome.counts_as_confirmed_copy());
        let message = verdict.message.expect("a refusal has a message");
        // It names the Identity it read back, and it names both likely causes.
        assert!(
            message.contains("still reads as 55 00 84 82 12"),
            "{message}"
        );
        assert!(message.contains("will not accept writes"), "{message}");
        assert!(message.contains("already been written"), "{message}");
        assert!(message.contains("never writable"), "{message}");
        // Nothing about the tag changed, so it must not imply it did.
        assert!(message.contains("was not destroyed"), "{message}");
    }

    #[test]
    fn a_still_reading_write_says_no_check_could_have_warned_first() {
        // The app must not leave the user thinking they skipped a pre-check.
        let verdict = verdict(
            LfOperation::Clear,
            &ClearAttempt::Transmitted(ClearReadback::Presents(written_tag())),
        );
        let message = verdict.message.unwrap_or_default();
        assert!(
            message.contains("cannot tell") || message.contains("no check"),
            "{message}"
        );
        assert!(message.contains("was not cleared"), "{message}");
    }

    #[test]
    fn a_write_whose_readback_failed_is_unverified_for_either_operation() {
        for operation in [LfOperation::Clear, LfOperation::Destroy] {
            let verdict = verdict(
                operation,
                &ClearAttempt::Transmitted(ClearReadback::Unreadable),
            );
            assert_eq!(verdict.outcome, WriteOutcome::Unverified);
            assert!(verdict.outcome.is_unknown());
            let message = verdict.message.expect("an unknown result says so");
            assert!(message.contains("could not be read back"), "{message}");
            assert!(message.contains("unknown"), "{message}");
        }
    }

    #[test]
    fn a_refusal_is_reported_as_the_guard_worded_it() {
        let verdict = verdict(LfOperation::Clear, &ClearAttempt::Refused("stop".to_string()));
        assert_eq!(verdict.outcome, WriteOutcome::Refused);
        assert_eq!(verdict.message.as_deref(), Some("stop"));
        assert!(!verdict.outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn a_transmission_that_never_happened_is_failed() {
        let verdict = verdict(
            LfOperation::Destroy,
            &ClearAttempt::Failed("USB write failed".to_string()),
        );
        assert_eq!(verdict.outcome, WriteOutcome::Failed);
        assert_eq!(verdict.message.as_deref(), Some("USB write failed"));
    }

    #[test]
    fn neither_operation_can_be_judged_as_the_other() {
        // The requirement at this seam too: whatever the evidence, a Clear
        // verdict is never `Destroyed` and a Destroy verdict is never `Cleared`.
        let attempts = [
            ClearAttempt::Refused("stop".to_string()),
            ClearAttempt::Failed("no device".to_string()),
            ClearAttempt::Transmitted(ClearReadback::NoIdentity),
            ClearAttempt::Transmitted(ClearReadback::Presents(Identity::CLEARED)),
            ClearAttempt::Transmitted(ClearReadback::Presents(written_tag())),
            ClearAttempt::Transmitted(ClearReadback::Unreadable),
        ];
        for attempt in attempts {
            assert_ne!(
                verdict(LfOperation::Clear, &attempt).outcome,
                WriteOutcome::Destroyed,
                "a clear was judged a destroy: {attempt:?}"
            );
            assert_ne!(
                verdict(LfOperation::Destroy, &attempt).outcome,
                WriteOutcome::Cleared,
                "a destroy was judged a clear: {attempt:?}"
            );
        }
    }

    #[test]
    fn nothing_but_a_witnessed_absence_of_identity_claims_a_destroy() {
        // The whole honesty requirement in one assertion: only one attempt shape
        // out of six may claim the Tag was destroyed.
        let attempts = [
            ClearAttempt::Refused("stop".to_string()),
            ClearAttempt::Failed("no device".to_string()),
            ClearAttempt::Transmitted(ClearReadback::Unreadable),
            ClearAttempt::Transmitted(ClearReadback::Presents(other_tag())),
            ClearAttempt::Transmitted(ClearReadback::Presents(Identity::CLEARED)),
        ];
        for attempt in attempts {
            assert_ne!(
                verdict(LfOperation::Destroy, &attempt).outcome,
                WriteOutcome::Destroyed,
                "{attempt:?} must not claim a destroy"
            );
        }
    }

    // ---- the re-read scan ------------------------------------------------

    #[test]
    fn a_whole_quiet_window_is_the_only_way_to_conclude_no_identity() {
        let mut scan = ClearScan::new();
        for _ in 0..8 {
            assert_eq!(scan.observe(TagPresence::Absent), None);
        }
        assert_eq!(scan.finish(8), ClearReadback::NoIdentity);
        assert_eq!(scan.quiet_readings(), 8);
    }

    #[test]
    fn one_empty_reply_is_not_a_conclusion() {
        // The firmware can need a moment after a write; an early empty reply is
        // not evidence, which is why the scan waits for the whole window.
        let mut scan = ClearScan::new();
        scan.observe(TagPresence::Absent);
        assert_eq!(scan.finish(8), ClearReadback::Unreadable);
    }

    #[test]
    fn a_tag_that_presents_an_identity_ends_the_scan_at_once() {
        let mut scan = ClearScan::new();
        assert_eq!(scan.observe(TagPresence::Absent), None);
        assert_eq!(
            scan.observe(TagPresence::Identified(written_tag())),
            Some(ClearReadback::Presents(written_tag()))
        );
    }

    #[test]
    fn a_present_tag_with_an_empty_data_field_also_counts_as_a_quiet_reading() {
        // Both shapes mean "no Identity is presented", and both are what a
        // destroyed Tag may look like depending on the firmware.
        let mut scan = ClearScan::new();
        for _ in 0..8 {
            scan.observe(TagPresence::Blank);
        }
        assert_eq!(scan.finish(8), ClearReadback::NoIdentity);
    }

    #[test]
    fn a_window_of_no_reads_proves_nothing() {
        let scan = ClearScan::new();
        assert_eq!(scan.finish(0), ClearReadback::Unreadable);
    }

    #[test]
    fn a_malformed_reply_concludes_nothing_either_way() {
        let mut scan = ClearScan::new();
        for _ in 0..7 {
            scan.observe(TagPresence::Absent);
        }
        scan.observe(TagPresence::Unreadable);
        assert_eq!(scan.finish(8), ClearReadback::Unreadable);
        assert_eq!(scan.malformed_readings(), 1);
    }
}

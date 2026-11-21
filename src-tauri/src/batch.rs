//! Batch Clone: one source Identity held and written to successive Blanks.
//!
//! A Clone copies one Tag's Identity onto a Blank (GLOSSARY). The several-people
//! case is the same Clone repeated — read the original once, then write as many
//! Blanks as there are recipients — and this module is the part of that which
//! can be decided and counted without a Reader attached.
//!
//! # What is reused rather than re-decided
//!
//!   * ADR 0001 stays exactly as it is: every attempt reads the Tag in the write
//!     position and writes nothing when it cannot. `write_guard::decide` makes
//!     that decision, and this module never makes its own.
//!   * `write_outcome` names what became of a transmitted write, and
//!     `WriteOutcome::counts_as_confirmed_copy` is the only counting rule. This
//!     module adds one outcome (`Skipped`) and maps it onto the copy path's
//!     `Refused` for counting, so there is still exactly one rule.
//!   * The payload is `identity::write_payload`'s 24 bytes, reached through
//!     `Reader::lf_write`. Nothing here builds a frame.
//!
//! # Per-attempt semantics, including the identical-Tag hazard
//!
//! The source Identity is read once, by the caller, and passed to every attempt.
//! Each *attempt* is then independent: the Tag in the write position is read
//! again, the guard decides again, and the outcome is reported on its own. A
//! refusal on one attempt does not end the run — the run is a list of results,
//! not one verdict.
//!
//! The hazard is ADR 0001's second refusal. After write #1 succeeds, the Tag
//! left on the Reader now presents the target Identity, so the guard refuses.
//! That refusal is *correct* and must not be bypassed "because we know what is
//! there": the same reading is what a source Tag left in place produces, and
//! writing that is how a T5577 was permanently locked. So the attempt is refused
//! exactly as ADR 0001 says — and this module reports it as **`Skipped`** rather
//! than as a plain refusal:
//!
//!   * `Skipped` says the Tag already carries the Identity, so there is nothing
//!     to write. The guard did not fail and nothing needs fixing by re-seating a
//!     Tag that is already correct.
//!   * The user is told which case it is likely to be: the original still in
//!     place, or a Tag that was already written in this run. Either way the next
//!     attempt needs a **fresh** Blank.
//!   * `Skipped` never counts. Leaving a written Tag in position and pressing
//!     the button again therefore reports a skip and leaves the count alone,
//!     instead of claiming a second copy of a Tag that does not exist.
//!
//! Two physically identical Blanks cannot be told apart: the Reader reports an
//! Identity and nothing else, so nothing here can distinguish a Blank that was
//! never written from a Blank that was written a minute ago and put back. That
//! is why the count is per *verified attempt* rather than a claim about how many
//! physical Tags exist, and why the UI says each attempt needs a fresh Tag.
//!
//! # What this module cannot prove
//!
//! Whether `0x0073` actually lands is a hardware question (ADR 0003 records the
//! same gap for blanking). Every rule below is a pure function over evidence, so
//! it is exercised with no Reader attached; the device path is
//! `src-tauri/examples/batchprobe.rs`.

use std::time::Duration;

use crate::identity::Identity;
use crate::reader::{LfCard, Reader};
use crate::write_guard::{self, WriteDecision};
use crate::write_outcome::{self, Evidence, WriteOutcome};

/// What one attempt in a batch produced, before it is judged.
#[derive(Debug)]
pub enum BatchAttempt {
    /// Nothing was transmitted: the guard refused. `current` is what the Tag in
    /// the write position presented, when it presented anything.
    Refused {
        decision: WriteDecision,
        current: Option<LfCard>,
    },
    /// The write command could not be transmitted, or the Reader failed while
    /// reading the Tag in the write position.
    Failed(String),
    /// The write was transmitted; this is what the Tag read back as, if
    /// anything. `None` means the read-back found no reading.
    Transmitted(Option<LfCard>),
}

/// What one attempt in a batch turned out to be.
///
/// `Write` carries the copy path's own vocabulary rather than repeating it, so
/// `refused`, `verified`, `unverified` and `failed` mean here exactly what they
/// mean for a single Clone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BatchOutcome {
    /// Not written, because the Tag in the write position already presents the
    /// target Identity. The guard refused exactly as ADR 0001 requires; this
    /// name says *why* in the one case that is expected during a batch.
    ///
    /// Never a copy: nothing was transmitted, so nothing can be verified.
    Skipped,
    /// The copy path's verdict.
    Write(WriteOutcome),
}

impl BatchOutcome {
    /// The stable wire name the UI switches on.
    pub fn as_str(self) -> &'static str {
        match self {
            BatchOutcome::Skipped => "skipped",
            BatchOutcome::Write(outcome) => outcome.as_str(),
        }
    }

    /// The copy path's outcome for counting and recording purposes.
    ///
    /// A skip maps to `Refused`: no bytes were sent because the guard stopped
    /// the write. Mapping it rather than adding a second counting rule keeps
    /// `WriteOutcome::counts_as_confirmed_copy` the single source of truth
    /// (ADR 0003 made the same choice for blanking).
    pub fn write_outcome(self) -> WriteOutcome {
        match self {
            BatchOutcome::Skipped => WriteOutcome::Refused,
            BatchOutcome::Write(outcome) => outcome,
        }
    }

    /// True only for a verified read-back. A skip, a refusal, an unknown result
    /// and a failed transmission all leave the count where it was.
    pub fn counts_as_confirmed_copy(self) -> bool {
        match self {
            BatchOutcome::Skipped => false,
            BatchOutcome::Write(outcome) => outcome.counts_as_confirmed_copy(),
        }
    }
}

/// One judged attempt: the outcome, the reason, and what the Tag read as.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchVerdict {
    pub outcome: BatchOutcome,
    /// Why this attempt did not confirm a copy, when it did not.
    pub message: Option<String>,
    /// What the Tag read as at the last reading taken for this attempt: the
    /// read-back for a transmitted write, or the reading that stopped it.
    pub readback: Option<LfCard>,
}

/// Judge one attempt against the Identity it was aiming at.
///
/// The guard's own decision is what decides the refusal cases, so ADR 0001 is
/// not re-implemented here. A Tag that already presents the target is the one
/// case this module renames, and the name is `Skipped`.
pub fn verdict(attempt: &BatchAttempt, target: Identity) -> BatchVerdict {
    match attempt {
        BatchAttempt::Refused {
            decision: WriteDecision::RefuseSameIdentity,
            current,
        } => BatchVerdict {
            outcome: BatchOutcome::Skipped,
            message: Some(format!(
                "the tag on the reader already reads as {target_id}, so nothing was written. \
                 That is either the original tag still on the reader, or a tag that was already \
                 written in this run — this attempt is not counted again. Put a fresh blank tag \
                 on the reader for the next attempt.",
                target_id = current
                    .as_ref()
                    .map(|c| c.id.clone())
                    .unwrap_or_else(|| target.id())
            )),
            readback: current.clone(),
        },
        BatchAttempt::Refused {
            decision: WriteDecision::RefuseUnreadable,
            current,
        } => BatchVerdict {
            outcome: BatchOutcome::Write(WriteOutcome::Refused),
            // The guard already words this one: it is the ADR 0001 refusal and
            // saying it twice would be a second, driftable copy of it.
            message: decision_message(
                WriteDecision::RefuseUnreadable,
                current.as_ref().map(LfCard::identity),
            ),
            readback: current.clone(),
        },
        // `WriteDecision::Proceed` is not a refusal, so a `Refused` carrying it
        // cannot have come from the guard. Treated as a refusal anyway: the
        // fail-closed direction is the only safe one for a shape that should not
        // exist.
        BatchAttempt::Refused { current, .. } => BatchVerdict {
            outcome: BatchOutcome::Write(WriteOutcome::Refused),
            message: Some(
                "the write was not attempted, and nothing was written. Put a blank 125 kHz tag \
                 on the reader and try again."
                    .to_string(),
            ),
            readback: current.clone(),
        },
        BatchAttempt::Failed(why) => BatchVerdict {
            outcome: BatchOutcome::Write(WriteOutcome::Failed),
            message: Some(why.clone()),
            readback: None,
        },
        BatchAttempt::Transmitted(readback) => {
            let read_back = readback.as_ref().map(LfCard::identity);
            let outcome = write_outcome::classify(Evidence::Readback(read_back), target);
            BatchVerdict {
                outcome: BatchOutcome::Write(outcome),
                message: readback_message(outcome, read_back, target),
                readback: readback.clone(),
            }
        }
    }
}

fn decision_message(decision: WriteDecision, current: Option<Identity>) -> Option<String> {
    decision.refusal_message(current)
}

/// Why a transmitted write did not confirm a copy, when it did not.
fn readback_message(
    outcome: WriteOutcome,
    readback: Option<Identity>,
    target: Identity,
) -> Option<String> {
    match outcome {
        WriteOutcome::Verified => None,
        // Sent, but the Tag did not read back as the target. Its state is
        // genuinely unknown, which is never reported as success or as a
        // definitive failure.
        _ => Some(match readback {
            Some(found) => format!(
                "the write was sent, but the tag read back as {found}, not {target}, so this \
                 attempt is not counted as a copy. Read the tag on the reader to find out what \
                 it holds.",
                found = found.id(),
                target = target.id()
            ),
            None => "the write was sent, but the tag could not be read back, so whether this \
                     attempt landed is unknown and it is not counted as a copy. Read the tag on \
                     the reader to find out what it holds."
                .to_string(),
        }),
    }
}

/// How many attempts of each kind a run has produced.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BatchCounts {
    pub verified: usize,
    pub skipped: usize,
    pub refused: usize,
    pub unverified: usize,
    pub failed: usize,
}

impl BatchCounts {
    /// Total attempts, whatever they turned out to be.
    pub fn attempts(&self) -> usize {
        self.verified + self.skipped + self.refused + self.unverified + self.failed
    }
}

/// One batch: the Identity being copied, and what each attempt came to.
///
/// The Identity is held here so that an attempt cannot accidentally re-read the
/// source or write something else: every attempt is judged against, and written
/// from, the Identity the run was started with.
#[derive(Debug, Clone)]
pub struct BatchRun {
    target: Identity,
    attempts: Vec<BatchVerdict>,
}

impl BatchRun {
    pub fn new(target: Identity) -> Self {
        Self {
            target,
            attempts: Vec::new(),
        }
    }

    /// The Identity every attempt writes. Held, not re-read.
    pub fn target(&self) -> Identity {
        self.target
    }

    /// Judge one attempt against the held Identity, record it, and return it.
    pub fn record_attempt(&mut self, attempt: &BatchAttempt) -> BatchVerdict {
        let verdict = verdict(attempt, self.target);
        self.attempts.push(verdict.clone());
        verdict
    }

    /// Record an already-judged attempt. The outcome is kept as given, so a
    /// skipped attempt stays skipped and stays out of the count.
    pub fn record(&mut self, verdict: BatchVerdict) -> BatchVerdict {
        self.attempts.push(verdict.clone());
        verdict
    }

    /// Every attempt so far, in the order they were made.
    pub fn attempts(&self) -> &[BatchVerdict] {
        &self.attempts
    }

    /// Per-kind totals: each attempt is counted once, under its own outcome.
    pub fn counts(&self) -> BatchCounts {
        let mut counts = BatchCounts::default();
        for verdict in &self.attempts {
            match verdict.outcome {
                BatchOutcome::Skipped => counts.skipped += 1,
                BatchOutcome::Write(WriteOutcome::Verified) => counts.verified += 1,
                BatchOutcome::Write(WriteOutcome::Refused) => counts.refused += 1,
                BatchOutcome::Write(WriteOutcome::Unverified) => counts.unverified += 1,
                // A copying attempt can never blank a Tag, so `Blanked` is not
                // a shape this run produces. Counting it as failed keeps the
                // totals honest rather than dropping an attempt on the floor.
                BatchOutcome::Write(WriteOutcome::Failed) => counts.failed += 1,
                BatchOutcome::Write(WriteOutcome::Blanked) => counts.failed += 1,
                // Nor can it erase NDEF content: erasing is its own operation
                // with its own word, and a copying run never reaches it. Same
                // treatment as `Blanked` for the same reason.
                BatchOutcome::Write(WriteOutcome::Erased) => counts.failed += 1,
            }
        }
        counts
    }

    /// Confirmed copies made by this run: verified attempts and nothing else.
    ///
    /// A skip is excluded by construction, which is what stops a Tag left in
    /// position from being counted twice.
    pub fn confirmed_copies(&self) -> u32 {
        self.attempts
            .iter()
            .filter(|v| v.outcome.counts_as_confirmed_copy())
            .count() as u32
    }
}

/// One guarded attempt: read the Tag in the write position, let the guard decide
/// again, write, then read back.
///
/// The read is per attempt and never once per run. That is ADR 0001's own
/// consequence ("batch writing must re-read between attempts") and the reason a
/// batch cannot collapse into a rapid-fire loop of writes.
///
/// Lives here rather than in `reader.rs` so that the batch's own vocabulary is
/// decided in one place; it drives the same shipping calls the single Clone does
/// (`read_tag_in_position`, `lf_write`, `lf_read_once`).
pub fn guarded_attempt(reader: &Reader, target: Identity) -> BatchAttempt {
    let current = match reader.read_tag_in_position() {
        Ok(current) => current,
        // The Reader failed before anything could be decided: this is a device
        // fault, not a guard refusal, and reporting it as one keeps the two
        // remedies apart (replug the Reader vs put a Blank on it).
        Err(e) => return BatchAttempt::Failed(e),
    };
    let decision = write_guard::decide(current.as_ref().map(LfCard::identity), target);
    if !decision.allows_write() {
        // Nothing is sent. A same-identity reading is the expected case during a
        // batch and is reported as a skip by `verdict`; it is still not written.
        return BatchAttempt::Refused { decision, current };
    }

    if let Err(e) = reader.lf_write(target) {
        return BatchAttempt::Failed(e);
    }

    // The same read-back window the single-clone path uses: the firmware can
    // need a moment after a write, and silence is not evidence.
    for _ in 0..8 {
        reader.wake().ok();
        match reader.lf_read_once() {
            Ok(Some(card)) => return BatchAttempt::Transmitted(Some(card)),
            Ok(None) => std::thread::sleep(Duration::from_millis(250)),
            // Sent already: a failing read leaves the Tag unknown, never
            // unwritten.
            Err(_) => return BatchAttempt::Transmitted(None),
        }
    }
    BatchAttempt::Transmitted(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_frames;

    /// The Tag this app wrote in the recorded working example: `55 00 84 82 12`.
    fn written_card() -> LfCard {
        LfCard::from_payload(&test_frames::payload(test_frames::LF_WRITE_READBACK))
            .expect("read-back capture decodes")
    }

    /// A different Tag: `56 00 53 C7 B3`, i.e. a Blank that holds something else.
    fn other_card() -> LfCard {
        LfCard::from_payload(&test_frames::payload(test_frames::LF_READ_CARD_PRESENT))
            .expect("read capture decodes")
    }

    /// The Identity a batch copies.
    fn target() -> Identity {
        written_card().identity()
    }

    /// The Tag in the write position already presents the target Identity: the
    /// shape after write #1, if the Tag is left where it is.
    fn already_written() -> BatchAttempt {
        BatchAttempt::Refused {
            decision: WriteDecision::RefuseSameIdentity,
            current: Some(written_card()),
        }
    }

    /// The guard allowed a write, judged from a Tag that read as something else.
    fn a_blank() -> BatchAttempt {
        BatchAttempt::Refused {
            decision: WriteDecision::Proceed,
            current: Some(other_card()),
        }
    }

    fn transmitted(readback: Option<LfCard>) -> BatchAttempt {
        BatchAttempt::Transmitted(readback)
    }

    fn nothing_readable() -> BatchAttempt {
        BatchAttempt::Refused {
            decision: WriteDecision::RefuseUnreadable,
            current: None,
        }
    }

    fn readback_of(v: &BatchVerdict) -> Option<Identity> {
        v.readback.as_ref().map(LfCard::identity)
    }

    // ---- the four outcomes, kept separately ------------------------------

    #[test]
    fn a_read_back_that_matches_is_verified() {
        let v = verdict(&transmitted(Some(written_card())), target());
        assert_eq!(v.outcome, BatchOutcome::Write(WriteOutcome::Verified));
        assert_eq!(v.outcome.as_str(), "verified");
        assert_eq!(v.message, None);
        assert_eq!(readback_of(&v), Some(target()));
        assert!(v.outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn a_tag_that_could_not_be_read_is_refused_and_nothing_is_written() {
        let v = verdict(&nothing_readable(), target());
        assert_eq!(v.outcome, BatchOutcome::Write(WriteOutcome::Refused));
        assert_eq!(v.outcome.as_str(), "refused");
        assert!(!v.outcome.counts_as_confirmed_copy());
        let message = v.message.expect("a refusal says why");
        // The guard's own words, not a second copy of them.
        assert!(message.contains("could not read"), "{message}");
        assert!(message.contains("write blind"), "{message}");
    }

    #[test]
    fn a_transmitted_write_with_no_read_back_is_unknown_not_a_copy() {
        let v = verdict(&transmitted(None), target());
        assert_eq!(v.outcome, BatchOutcome::Write(WriteOutcome::Unverified));
        assert!(!v.outcome.counts_as_confirmed_copy());
        let message = v.message.expect("an unknown result says so");
        assert!(message.contains("could not be read back"), "{message}");
        assert!(message.contains("unknown"), "{message}");
    }

    #[test]
    fn a_read_back_presenting_something_else_is_unknown_and_names_both() {
        let v = verdict(&transmitted(Some(other_card())), target());
        assert_eq!(v.outcome, BatchOutcome::Write(WriteOutcome::Unverified));
        assert!(!v.outcome.counts_as_confirmed_copy());
        let message = v.message.expect("an unknown result says so");
        assert!(message.contains("56 00 53 C7 B3"), "what it read: {message}");
        assert!(message.contains("55 00 84 82 12"), "what it aimed at: {message}");
        assert!(message.contains("not counted as a copy"), "{message}");
    }

    #[test]
    fn a_write_that_never_reached_the_reader_is_failed() {
        let v = verdict(&BatchAttempt::Failed("USB write failed".to_string()), target());
        assert_eq!(v.outcome, BatchOutcome::Write(WriteOutcome::Failed));
        assert_eq!(v.outcome.as_str(), "failed");
        assert_eq!(v.message.as_deref(), Some("USB write failed"));
        assert!(!v.outcome.counts_as_confirmed_copy());
    }

    #[test]
    fn the_outcomes_carry_distinct_wire_names() {
        let names: Vec<&str> = [
            BatchOutcome::Skipped,
            BatchOutcome::Write(WriteOutcome::Verified),
            BatchOutcome::Write(WriteOutcome::Unverified),
            BatchOutcome::Write(WriteOutcome::Refused),
            BatchOutcome::Write(WriteOutcome::Failed),
        ]
        .iter()
        .map(|o| o.as_str())
        .collect();
        assert_eq!(
            names,
            vec!["skipped", "verified", "unverified", "refused", "failed"]
        );
    }

    // ---- the identical-Tag hazard ----------------------------------------

    #[test]
    fn a_tag_already_presenting_the_target_is_skipped_and_says_so() {
        let v = verdict(&already_written(), target());
        assert_eq!(v.outcome, BatchOutcome::Skipped);
        assert_eq!(v.outcome.as_str(), "skipped");
        // The guard refused, so no counting rule is bent: a skip is not a copy.
        assert!(!v.outcome.counts_as_confirmed_copy());
        assert_eq!(v.outcome.write_outcome(), WriteOutcome::Refused);
        assert_eq!(readback_of(&v), Some(target()));

        let message = v.message.expect("a skip is explained");
        assert!(message.contains("55 00 84 82 12"), "{message}");
        assert!(message.contains("nothing was written"), "{message}");
        assert!(message.contains("not counted again"), "{message}");
        assert!(message.contains("fresh blank tag"), "{message}");
    }

    #[test]
    fn a_skip_is_never_worded_as_a_copy_or_as_a_failure_to_seat_a_tag() {
        let v = verdict(&already_written(), target());
        let message = v.message.expect("a skip is explained");
        // It is not the unreadable refusal: the Tag was read perfectly well.
        assert!(!message.contains("could not read"), "{message}");
        // And it never claims the copy landed.
        assert!(!message.contains("verified"), "{message}");
    }

    #[test]
    fn the_same_tag_left_in_position_across_two_attempts_is_counted_once() {
        // The whole hazard in one test. Attempt 1 writes a Blank and is verified;
        // the Tag is then left on the Reader, so attempt 2 reads back as the
        // target and must be skipped, not written, and not counted again.
        let mut run = BatchRun::new(target());

        let first = run.record_attempt(&transmitted(Some(written_card())));
        assert_eq!(first.outcome, BatchOutcome::Write(WriteOutcome::Verified));
        assert_eq!(run.confirmed_copies(), 1);

        let second = run.record_attempt(&already_written());
        assert_eq!(second.outcome, BatchOutcome::Skipped);
        assert_eq!(
            run.confirmed_copies(),
            1,
            "a Tag left in position must not be counted twice"
        );
        assert_eq!(run.attempts().len(), 2, "both attempts are still reported");
        assert_eq!(run.counts().verified, 1);
        assert_eq!(run.counts().skipped, 1);
    }

    #[test]
    fn three_presses_with_one_tag_in_place_still_count_one_copy() {
        // The inattentive-loop failure mode: press write repeatedly without
        // swapping Tags. One copy exists; the run must not claim three.
        let mut run = BatchRun::new(target());
        run.record_attempt(&transmitted(Some(written_card())));
        for _ in 0..2 {
            run.record_attempt(&already_written());
        }
        assert_eq!(run.confirmed_copies(), 1);
        assert_eq!(run.counts().attempts(), 3);
    }

    #[test]
    fn a_skip_does_not_stop_the_next_attempt_from_writing_a_fresh_blank() {
        // Skipping is a report, not a lock-out: a fresh Blank proceeds.
        let mut run = BatchRun::new(target());
        run.record_attempt(&already_written());
        run.record_attempt(&transmitted(Some(written_card())));
        assert_eq!(run.counts().skipped, 1);
        assert_eq!(run.counts().verified, 1);
        assert_eq!(run.confirmed_copies(), 1);
    }

    // ---- refusals do not abort the run -----------------------------------

    #[test]
    fn a_refusal_on_one_attempt_does_not_abort_the_run() {
        let mut run = BatchRun::new(target());
        run.record_attempt(&nothing_readable());
        assert_eq!(run.counts().refused, 1);
        assert_eq!(run.confirmed_copies(), 0);

        // The next attempt is a fresh decision and can succeed.
        let next = run.record_attempt(&transmitted(Some(written_card())));
        assert_eq!(next.outcome, BatchOutcome::Write(WriteOutcome::Verified));
        assert_eq!(run.confirmed_copies(), 1);
        assert_eq!(run.attempts().len(), 2, "a refusal is reported, not dropped");
    }

    #[test]
    fn an_unreadable_tag_after_a_verified_attempt_is_still_refused() {
        // The guard is checked per attempt, never once for the batch: a Tag that
        // reads perfectly well for attempt 1 says nothing about attempt 2, and an
        // empty or unreadable field after a success is refused, not written.
        let mut run = BatchRun::new(target());
        run.record_attempt(&transmitted(Some(written_card())));
        let second = run.record_attempt(&nothing_readable());
        assert_eq!(second.outcome, BatchOutcome::Write(WriteOutcome::Refused));
        assert_eq!(run.counts().refused, 1);
        assert_eq!(run.confirmed_copies(), 1, "the refusal did not undo the copy");
    }

    #[test]
    fn a_failed_transmission_does_not_abort_the_run_either() {
        let mut run = BatchRun::new(target());
        run.record_attempt(&BatchAttempt::Failed("no device".to_string()));
        run.record_attempt(&transmitted(Some(written_card())));
        assert_eq!(run.counts().failed, 1);
        assert_eq!(run.counts().verified, 1);
    }

    #[test]
    fn every_attempt_is_decided_from_its_own_reading() {
        // ADR 0001 is per attempt, never once for the run: the same run reaches
        // refuse, verify, skip and unknown outcomes in one sequence, each from
        // its own reading of the Tag in the write position.
        let mut run = BatchRun::new(target());
        assert_eq!(run.record_attempt(&nothing_readable()).outcome.as_str(), "refused");
        assert_eq!(
            run.record_attempt(&transmitted(Some(written_card()))).outcome.as_str(),
            "verified"
        );
        assert_eq!(run.record_attempt(&already_written()).outcome.as_str(), "skipped");
        assert_eq!(
            run.record_attempt(&transmitted(None)).outcome.as_str(),
            "unverified"
        );
        assert_eq!(run.counts().attempts(), 4);
        assert_eq!(run.counts().verified, 1);
    }

    // ---- counting --------------------------------------------------------

    #[test]
    fn only_a_verified_attempt_counts_as_a_copy() {
        let shapes = [
            nothing_readable(),
            already_written(),
            transmitted(None),
            transmitted(Some(other_card())),
            BatchAttempt::Failed("no device".to_string()),
            a_blank(),
        ];
        for attempt in shapes {
            let v = verdict(&attempt, target());
            assert!(
                !v.outcome.counts_as_confirmed_copy(),
                "{:?} must not count as a copy",
                v.outcome
            );
        }
        assert!(verdict(&transmitted(Some(written_card())), target())
            .outcome
            .counts_as_confirmed_copy());
    }

    #[test]
    fn the_run_counts_each_attempt_once_under_its_own_outcome() {
        let mut run = BatchRun::new(target());
        run.record_attempt(&transmitted(Some(written_card())));
        run.record_attempt(&nothing_readable());
        run.record_attempt(&already_written());
        run.record_attempt(&transmitted(None));
        run.record_attempt(&BatchAttempt::Failed("no device".to_string()));

        let counts = run.counts();
        assert_eq!(counts.verified, 1);
        assert_eq!(counts.refused, 1);
        assert_eq!(counts.skipped, 1);
        assert_eq!(counts.unverified, 1);
        assert_eq!(counts.failed, 1);
        assert_eq!(counts.attempts(), 5);
        assert_eq!(counts.attempts(), run.attempts().len());
        assert_eq!(run.confirmed_copies(), 1);
    }

    #[test]
    fn order_does_not_change_the_totals() {
        // This is a tally, not a state machine that can be talked out of an
        // earlier verdict.
        let mut run = BatchRun::new(target());
        run.record_attempt(&already_written());
        run.record_attempt(&transmitted(Some(written_card())));
        run.record_attempt(&nothing_readable());
        assert_eq!(run.counts().skipped, 1);
        assert_eq!(run.counts().verified, 1);
        assert_eq!(run.counts().refused, 1);
        assert_eq!(run.counts().verified, run.confirmed_copies() as usize);
    }

    #[test]
    fn a_recorded_verdict_reaches_the_run_unchanged() {
        // `record` exists so a caller that already judged an attempt cannot have
        // it re-judged into something else on the way in.
        let mut run = BatchRun::new(target());
        let skip = verdict(&already_written(), target());
        run.record(skip.clone());
        assert_eq!(run.attempts(), &[skip]);
        assert_eq!(run.confirmed_copies(), 0);
    }

    #[test]
    fn a_run_before_any_attempt_has_no_copies() {
        let run = BatchRun::new(target());
        assert_eq!(run.confirmed_copies(), 0);
        assert_eq!(run.counts().attempts(), 0);
        assert!(run.attempts().is_empty());
    }

    // ---- the held source Identity ----------------------------------------

    #[test]
    fn the_run_holds_the_source_identity_and_never_rereads_it() {
        let mut run = BatchRun::new(target());
        assert_eq!(run.target(), target());
        for _ in 0..3 {
            run.record_attempt(&transmitted(Some(written_card())));
        }
        // The Identity every attempt was judged against is the one the run was
        // started with: no attempt can substitute a re-read of the source.
        assert_eq!(run.target(), target());
        assert_eq!(run.confirmed_copies(), 3);
    }

    #[test]
    fn a_verdict_carries_what_the_tag_read_as_so_the_ui_can_name_it() {
        // A refusal that read something names it; one that read nothing has no
        // value to name, and must not invent one.
        assert_eq!(readback_of(&verdict(&already_written(), target())), Some(target()));
        assert_eq!(readback_of(&verdict(&nothing_readable(), target())), None);
        assert_eq!(
            readback_of(&verdict(&transmitted(Some(written_card())), target())),
            Some(target())
        );
    }
}

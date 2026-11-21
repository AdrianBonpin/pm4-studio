//! Hardware probe for a Batch Clone: one source Identity, several attempts.
//!
//! Two questions, one process:
//!
//!   1. Is a source Identity read once and reused, rather than re-read per
//!      attempt? (It must be: an attempt would otherwise write the wrong Tag.)
//!   2. Does an attempt whose Tag already presents that Identity get skipped
//!      instead of written, and left out of the count?
//!
//! It uses the shipping code — `batch::guarded_attempt`, `batch::verdict`,
//! `batch::BatchRun` — so what it prints is what the app does.
//!
//! Usage:
//!   cargo run --example batchprobe -- read
//!   cargo run --example batchprobe -- run [attempts] [pause-seconds]
//!
//! `read` writes nothing: it reports what the Tag in the field holds, which is
//! how you find the Identity you are about to copy.
//!
//! `run` reads the Tag on the Reader **once** and treats that reading as the
//! source Identity, exactly as the wizard does. It then makes `attempts`
//! attempts (default 3), waiting `pause-seconds` (default 12) between them so a
//! Blank can be swapped in. Each attempt re-reads the Tag in the write position,
//! because ADR 0001 is per attempt.
//!
//! The first attempt usually runs with the source Tag still on the Reader, which
//! is the interesting case: it must be **skipped**, never written. Take the
//! source off and put a Blank on during the first pause.
//!
//! Every attempt after the first consumes a Blank, so `run` with N attempts needs
//! N - 1 Blanks you are willing to lose. A T5577 can be permanently locked by a
//! write, and the source Tag is the credential you are keeping.
//!
//! A wedged firmware, or another process holding the exclusive USB handle
//! (`0xE00002C5`), is reported and the process exits without retrying. Do not
//! kill other processes to get the device: unplug the Reader if it is wedged,
//! and close whatever holds it otherwise.

use std::time::Duration;

use pm4_studio_lib::batch::{self, BatchRun};
use pm4_studio_lib::identity::TagPresence;
use pm4_studio_lib::reader::Reader;

/// Read the Tag in the field, with presence kept apart from the Identity.
fn read(r: &Reader) -> Result<TagPresence, String> {
    for attempt in 0..10 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(200));
        }
        r.wake().ok();
        match r.lf_read_presence_once()? {
            TagPresence::Absent => continue,
            found => return Ok(found),
        }
    }
    Ok(TagPresence::Absent)
}

fn describe(presence: TagPresence) -> String {
    match presence {
        TagPresence::Absent => "no tag latched".to_string(),
        TagPresence::Unreadable => "reply too short to decode".to_string(),
        TagPresence::Blank => "tag present, NO identity (data field empty)".to_string(),
        TagPresence::Identified(identity) => format!("tag present as {}", identity.id()),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = args.first().cloned().unwrap_or_else(|| "read".to_string());
    if mode != "read" && mode != "run" {
        eprintln!("usage: batchprobe [read | run [attempts] [pause-seconds]]");
        std::process::exit(2);
    }

    let reader = match Reader::open() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("open failed: {e}");
            eprintln!(
                "If this says the device is in use (0xE00002C5), another process holds the \
                 Reader. Close it; do not kill it."
            );
            std::process::exit(1);
        }
    };

    let before = match read(&reader) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("read failed: {e}  (device may be wedged — replug it)");
            std::process::exit(4);
        }
    };
    println!("tag on reader: {}", describe(before));

    if mode == "read" {
        println!(
            "\nnothing was written. Run `batchprobe run` with this Tag on the reader to treat \
             this reading as the source identity."
        );
        return;
    }

    // ---- the source Identity is read ONCE, here --------------------------
    let source = match before {
        TagPresence::Identified(identity) => identity,
        TagPresence::Blank => {
            println!("\nthis tag carries no identity, so there is nothing to copy from it.");
            std::process::exit(3);
        }
        TagPresence::Absent | TagPresence::Unreadable => {
            println!("\nno tag to read as the source: put the Tag you want to copy on the reader.");
            std::process::exit(3);
        }
    };
    // Everything after this line uses `source`. It is never read again.
    println!("source identity held: {}", source.id());

    let attempts: usize = args
        .get(1)
        .and_then(|n| n.parse().ok())
        .unwrap_or(3)
        .max(1);
    let pause: u64 = args
        .get(2)
        .and_then(|n| n.parse().ok())
        .unwrap_or(12);

    println!(
        "\n{} attempt(s), {pause}s apart. The first attempt will probably see the source tag \
         still in place — that must be SKIPPED, not written. Take the source off and put a \
         blank on during the first pause.",
        attempts
    );

    let mut run = BatchRun::new(source);
    for index in 0..attempts {
        if index > 0 {
            println!(
                "\n— pause {pause}s: take the tag off the reader and put the next blank on —"
            );
            std::thread::sleep(Duration::from_secs(pause));
        }
        println!("\nattempt {} of {attempts}", index + 1);
        let attempt = batch::guarded_attempt(&reader, run.target());
        let verdict = run.record_attempt(&attempt);
        println!("  evidence  : {attempt:?}");
        println!("  outcome   : {}", verdict.outcome.as_str());
        if let Some(card) = &verdict.readback {
            println!("  read back : {}", card.id);
        }
        if let Some(message) = &verdict.message {
            println!("  message   : {message}");
        }
        println!("  copies so far: {}", run.confirmed_copies());
    }

    let counts = run.counts();
    println!("\n--- result ---");
    println!(
        "attempts  : {} ({} verified, {} skipped, {} refused, {} unknown, {} failed)",
        counts.attempts(),
        counts.verified,
        counts.skipped,
        counts.refused,
        counts.unverified,
        counts.failed
    );
    println!("copies    : {}", run.confirmed_copies());
    println!(
        "source    : {} (held for the whole run; never re-read)",
        run.target().id()
    );
    if counts.skipped > 0 {
        println!(
            "a skipped attempt wrote nothing: the tag in position already carried this identity, \
             which is the case that must never be written again."
        );
    }
    if counts.verified == 0 {
        println!(
            "no copy was verified, so nothing here shows that 0x0073 lands on a T5577. That \
             would remain an unverified claim."
        );
    }
}

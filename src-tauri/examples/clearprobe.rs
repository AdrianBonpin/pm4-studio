//! Hardware probe for clearing and destroying a 125 kHz Tag's Identity.
//!
//! One process, one question at a time: what does the Tag carry after Clear's
//! placeholder write, and does it still take a write; or what does it report after
//! Destroy's all-zero write?
//!
//! It uses the shipping code — `Reader::lf_clear_attempt`, the `clear` guard and
//! `clear::verdict` — so what it prints is what the app does, not a parallel
//! experiment. Nothing here writes except in `clear` and `destroy` mode.
//!
//! Usage:
//!   cargo run --example clearprobe -- read     # read only, writes nothing
//!   cargo run --example clearprobe -- clear    # write the placeholder once
//!   cargo run --example clearprobe -- destroy  # write the neutral Identity once
//!
//! `read` is safe to run any number of times. **`destroy` consumes one Tag:** three
//! T5577s written with the neutral payload stopped accepting data permanently while
//! still latching and modulating. `clear` writes the clone-shaped placeholder, which
//! is the layout every routine Clone uses and which has never locked a chip — but no
//! fresh T5577 has confirmed that, so treat it as a probe and not as a safe
//! experiment on a Tag you need.
//!
//! A wedged firmware, or another process holding the exclusive USB handle
//! (`0xE00002C5`), is reported and the process exits without retrying. Do not
//! kill other processes to get the device: unplug the Reader if it is wedged,
//! and close whatever holds it otherwise.

use pm4_studio_lib::clear::{self, ClearAttempt, LfOperation};
use pm4_studio_lib::identity::TagPresence;
use pm4_studio_lib::reader::Reader;

/// Read the tag in the field, with presence kept apart from the Identity.
fn read(r: &Reader) -> Result<TagPresence, String> {
    for attempt in 0..10 {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(200));
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
    let mode = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "read".to_string());
    let operation = match mode.as_str() {
        "read" => None,
        "clear" => Some(LfOperation::Clear),
        "destroy" => Some(LfOperation::Destroy),
        _ => {
            eprintln!("usage: clearprobe [read|clear|destroy]");
            std::process::exit(2);
        }
    };

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
    println!("tag before   : {}", describe(before));

    let Some(operation) = operation else {
        return;
    };

    let confirmed = match before {
        TagPresence::Identified(identity) => identity,
        // Clear can still put the placeholder on a Tag with no Identity; the
        // guard decides that, not this probe.
        TagPresence::Blank => confirmed_or_exit(operation),
        TagPresence::Absent | TagPresence::Unreadable => {
            println!(
                "\nno tag to {}: put a 125 kHz tag on the reader and run again.",
                operation.verb()
            );
            std::process::exit(3);
        }
    };

    let decision = clear::decide(before, confirmed, operation);
    println!("confirmed    : {}", confirmed.id());
    println!("operation    : {}", operation.as_str());
    println!("guard        : {decision:?}");
    if let Some(refusal) = decision.refusal_message(operation, confirmed, Some(confirmed)) {
        println!("refused      : {refusal}");
        return;
    }

    println!(
        "payload      : {} ({})",
        operation.as_str(),
        match operation {
            LfOperation::Clear => "customer 0x00, data32 0x00FFFFFF — the placeholder",
            LfOperation::Destroy => "customer 0x00, data32 0x00000000 — the neutral Identity",
        }
    );
    println!("sending      : 0x0073 …");
    let attempt = reader.lf_clear_attempt(confirmed, operation);
    let verdict = clear::verdict(operation, &attempt);

    match &attempt {
        ClearAttempt::Refused(why) => println!("attempt      : refused ({why})"),
        ClearAttempt::Failed(why) => println!("attempt      : failed ({why})"),
        ClearAttempt::Transmitted(readback) => {
            println!("attempt      : transmitted ({readback:?})")
        }
    }
    println!("outcome      : {}", verdict.outcome.as_str());
    if let Some(message) = &verdict.message {
        println!("message      : {message}");
    }

    // Independent re-reads, after the fact: what does the tag report now?
    // Absent and Blank are told apart here, which is the whole point of the
    // presence-aware decoder.
    println!("\nre-reading…");
    let mut quiet = 0;
    for i in 0..5 {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(400));
        }
        match read(&reader) {
            Ok(presence) => {
                if matches!(presence, TagPresence::Absent | TagPresence::Blank) {
                    quiet += 1;
                }
                println!("  after[{i}]   : {}", describe(presence));
            }
            Err(e) => {
                println!("  after[{i}]   : read failed ({e})");
                break;
            }
        }
    }

    println!("\n--- result ---");
    println!("outcome      : {}", verdict.outcome.as_str());
    if matches!(attempt, ClearAttempt::Transmitted(_)) {
        match operation {
            LfOperation::Clear => {
                if quiet == 5 {
                    println!("the tag no longer presents an identity on any of 5 reads: the");
                    println!("placeholder did not land, which is a write that did not take.");
                } else {
                    println!("the tag still presents something; see the reads above. Clear's");
                    println!("success is the placeholder 00 FF FF FF FF, and nothing else is one.");
                }
                println!(
                    "whether the tag still accepts writes is not tested here: a later write is \
                     the only test, and running one by hand is the next step (see the ticket)."
                );
            }
            LfOperation::Destroy => {
                if quiet == 5 {
                    println!("the tag no longer presents an identity on any of 5 reads.");
                } else {
                    println!("the tag still presents something; see the reads above.");
                }
                println!(
                    "whether the tag still accepts writes is not tested here: that would consume \
                     it twice, and a destroyed tag permanently refuses data."
                );
            }
        }
    }
}

/// A Tag with no Identity still has a "confirmed" value for Clear — the guard is
/// what decides whether the write may proceed — but Destroy has nothing to
/// confirm, so the probe stops where the app would.
fn confirmed_or_exit(operation: LfOperation) -> pm4_studio_lib::identity::Identity {
    match operation {
        LfOperation::Clear => pm4_studio_lib::identity::Identity::CLEARED,
        LfOperation::Destroy => {
            println!("\nnothing to destroy: this tag already carries no identity.");
            std::process::exit(0);
        }
    }
}

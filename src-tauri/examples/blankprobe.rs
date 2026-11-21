//! Hardware probe for blanking a 125 kHz Tag's Identity.
//!
//! One process, one question: does writing the neutral Identity actually leave
//! the Tag carrying no Identity, and what does the read path report afterwards?
//!
//! It uses the shipping code — `Reader::lf_blank_attempt`, the `blank` guard and
//! `blank::verdict` — so what it prints is what the app does, not a parallel
//! experiment. Nothing here writes except in `blank` mode.
//!
//! Usage:
//!   cargo run --example blankprobe -- read    # read only, writes nothing
//!   cargo run --example blankprobe -- blank   # blank the tag on the reader once
//!
//! `read` is safe to run any number of times. `blank` consumes one Tag: a
//! blanked Tag may stop accepting writes, and one T5577 is already permanently
//! locked from earlier experiments. Only run it with a Tag you are willing to
//! lose.
//!
//! A wedged firmware, or another process holding the exclusive USB handle
//! (`0xE00002C5`), is reported and the process exits without retrying. Do not
//! kill other processes to get the device: unplug the Reader if it is wedged,
//! and close whatever holds it otherwise.

use pm4_studio_lib::blank::{self, BlankAttempt};
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
    if mode != "read" && mode != "blank" {
        eprintln!("usage: blankprobe [read|blank]");
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
    println!("tag before   : {}", describe(before));

    if mode == "read" {
        return;
    }

    let confirmed = match before {
        TagPresence::Identified(identity) => identity,
        TagPresence::Blank => {
            println!("\nnothing to blank: this tag already carries no identity.");
            return;
        }
        TagPresence::Absent | TagPresence::Unreadable => {
            println!("\nno tag to blank: put a 125 kHz tag on the reader and run again.");
            std::process::exit(3);
        }
    };

    let decision = blank::decide(before, confirmed);
    println!("confirmed    : {}", confirmed.id());
    println!("guard        : {decision:?}");
    if let Some(refusal) = decision.refusal_message(confirmed, Some(confirmed)) {
        println!("refused      : {refusal}");
        return;
    }

    println!("payload      : neutral identity (customer 0x00, data32 0x00000000)");
    println!("sending      : 0x0073 …");
    let attempt = reader.lf_blank_attempt(confirmed);
    let verdict = blank::verdict(&attempt);

    match &attempt {
        BlankAttempt::Refused(why) => println!("attempt      : refused ({why})"),
        BlankAttempt::Failed(why) => println!("attempt      : failed ({why})"),
        BlankAttempt::Transmitted(readback) => {
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
    if matches!(attempt, BlankAttempt::Transmitted(_)) {
        if quiet == 5 {
            println!("the tag no longer presents an identity on any of 5 reads.");
        } else {
            println!("the tag still presents something; see the reads above.");
        }
        // A blanked T5577 may refuse further writes; a read still works, so this
        // probe cannot tell by itself. Write something to it deliberately if you
        // want to find out.
        println!(
            "whether the tag still accepts writes is not tested here: that would consume it \
             twice, and a blanked tag may be unusable for further writes."
        );
    }
}

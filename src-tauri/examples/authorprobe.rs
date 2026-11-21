//! Hardware probe for authoring an Identity by hand and writing it to a Blank.
//!
//! One process, one question: does a value typed into the authoring form reach a
//! real 125 kHz Tag as the Identity the decoder then reports?
//!
//! It uses the shipping code — `author_identity::from_parts` / `from_hex` and
//! `preview`, the `write_guard` behind `Reader::lf_write_attempt`, and
//! `write_outcome::classify` — so what it prints is what the app does, not a
//! parallel experiment.
//!
//! Usage:
//!   cargo run --example authorprobe -- read
//!   cargo run --example authorprobe -- parts <customer> <facility> <card>
//!   cargo run --example authorprobe -- hex "<five bytes>"
//!
//! Examples:
//!   cargo run --example authorprobe -- parts 85 0x84 33298
//!   cargo run --example authorprobe -- hex "55 00 84 82 12"
//!
//! `read` writes nothing and is safe to run any number of times. `parts` and
//! `hex` each consume one Blank: a T5577 may refuse further writes after one,
//! and one of this project's test tags is already permanently locked. Only run a
//! write with a Blank on the reader that you are willing to lose.
//!
//! The write is guarded exactly as the app's is (ADR 0001): the tag in the write
//! position is read first, and a tag that cannot be read — or that already
//! presents the Identity being written — is refused. There is no override here
//! either.
//!
//! A wedged firmware, or another process holding the exclusive USB handle
//! (`0xE00002C5`), is reported and the process exits without retrying. Do not
//! kill other processes to get the device: unplug the Reader if it is wedged, and
//! close whatever holds it otherwise.

use pm4_studio_lib::author_identity::{self, AuthorError, Preview};
use pm4_studio_lib::identity::TagPresence;
use pm4_studio_lib::reader::{LfWriteAttempt, Reader};
use pm4_studio_lib::write_outcome::{self, Evidence};

/// Read the tag in the field, keeping presence apart from Identity.
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
        TagPresence::Blank => "tag present, no identity (data field empty)".to_string(),
        TagPresence::Identified(identity) => format!(
            "tag present as {} (customer 0x{:02X}, facility {}, card {})",
            identity.id(),
            identity.customer,
            identity.facility(),
            identity.card()
        ),
    }
}

/// The Identity the command line asked for, or the refusal that names the range.
fn authored(mode: &str, rest: &[String]) -> Result<Preview, AuthorError> {
    let identity = if mode == "parts" {
        author_identity::from_parts(&rest[0], &rest[1], &rest[2])?
    } else {
        author_identity::from_hex(&rest.join(" "))?
    };
    author_identity::preview(identity)
}

fn usage() -> ! {
    eprintln!("usage: authorprobe read");
    eprintln!("       authorprobe parts <customer> <facility> <card>");
    eprintln!("       authorprobe hex \"<five bytes>\"");
    std::process::exit(2);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = args.first().cloned().unwrap_or_else(|| "read".to_string());
    let rest: Vec<String> = args.iter().skip(1).cloned().collect();
    match (mode.as_str(), rest.len()) {
        ("read", _) => {}
        ("parts", 3) | ("hex", _) if mode == "parts" || !rest.is_empty() => {}
        _ => usage(),
    }

    // Author first: a bad entry costs nothing and must be refused before the
    // device is even touched.
    let preview = if mode == "read" {
        None
    } else {
        match authored(&mode, &rest) {
            Ok(preview) => Some(preview),
            Err(error) => {
                eprintln!("refused: {error}");
                std::process::exit(5);
            }
        }
    };

    if let Some(preview) = &preview {
        println!("authored id  : {}", preview.id);
        println!("customer     : 0x{:02X}", preview.identity.customer);
        println!("facility     : {}", preview.identity.facility());
        println!("card         : {}", preview.identity.card());
        println!("data32       : 0x{:08X}", preview.identity.data32);
        println!("payload (24) : {}", preview.payload_hex);
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

    let Some(preview) = preview else {
        return;
    };

    // The same guarded path the app uses. Nothing is bypassed.
    println!("sending      : 0x0073 (guarded: the tag is read first) …");
    let attempt = reader.lf_write_attempt(preview.identity);
    let (evidence, message) = match &attempt {
        LfWriteAttempt::Refused(why) => (Evidence::Refused, Some(why.clone())),
        LfWriteAttempt::Failed(why) => (Evidence::NotTransmitted, Some(why.clone())),
        LfWriteAttempt::Transmitted(card) => (
            Evidence::Readback(card.as_ref().map(|c| c.identity())),
            None,
        ),
    };
    let outcome = write_outcome::classify(evidence, preview.identity);

    match &attempt {
        LfWriteAttempt::Refused(why) => println!("attempt      : refused ({why})"),
        LfWriteAttempt::Failed(why) => println!("attempt      : failed ({why})"),
        LfWriteAttempt::Transmitted(card) => println!(
            "read-back    : {}",
            card.as_ref()
                .map(|c| format!("{} (facility {}, card {}, raw {})", c.id, c.facility, c.card, c.raw))
                .unwrap_or_else(|| "no identity read back".to_string())
        ),
    }
    println!("outcome      : {}", outcome.as_str());
    println!(
        "confirmed    : {}",
        if outcome.counts_as_confirmed_copy() {
            "yes — a confirmed copy"
        } else if outcome.is_unknown() {
            "no — the tag's state is unknown"
        } else {
            "no"
        }
    );
    if let Some(message) = message {
        println!("message      : {message}");
    }
    if outcome != write_outcome::WriteOutcome::Verified {
        println!("\nRead the tag again before drawing any conclusion from this run.");
    }
}

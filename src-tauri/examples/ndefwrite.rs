//! Hardware probe: write one whole NDEF message to a 13.56 MHz Tag.
//!
//! This is the probe ticket 18 needs. The spike (ticket 16) proved a *single*
//! page write; an NDEF message spans several pages and needs several page-state
//! entries set in one request, which is open problem 2 in docs/PROTOCOL.md. This
//! runs the shipping code path (`pm4_studio_lib::ntag`) against a real Tag and
//! prints exactly what happened, so the multi-page question is answered by a
//! transcript rather than by assumption.
//!
//! Usage (from src-tauri/):
//!
//!   cargo run --example ndefwrite -- --yes-disposable
//!   cargo run --example ndefwrite -- --yes-disposable --message-hex D1010455...
//!
//! `--yes-disposable` is required: the Tag's existing NDEF message is replaced.
//! Only run this with a Tag you are willing to lose.
//!
//! Exits 0 when the read-back matched what was written, 1 when the write was
//! sent but not confirmed, 2 when nothing was written or the probe could not run.

use pm4_studio_lib::ntag::{self, DEFAULT_TAG_SELECTOR};
use pm4_studio_lib::reader::{hex, Reader, VID, PID};

/// A multi-page Text Record. `PM4 Studio NDEF write probe, multi-page.` is 41
/// bytes of text, so the record is 43 payload bytes, the message 48 and the TLV
/// 51 — 13 pages, i.e. twelve more than the spike ever wrote in one request.
const PROBE_TEXT: &str = "PM4 Studio NDEF write probe, multi-page.";

/// A well-known Text Record: `D1 01 <len> 'T' <status> "en" <text>`.
///
/// `D1` is MB | ME | SR | TNF 1, i.e. a short, well-known record that is both
/// the first and the last of the message. `status` is the language-code length
/// in its low six bits, with bit 7 clear for UTF-8.
fn text_record(language: &str, text: &str) -> Vec<u8> {
    assert!(language.len() <= 0x3F, "a language code cannot exceed 63 bytes");
    let mut payload = vec![language.len() as u8];
    payload.extend_from_slice(language.as_bytes());
    payload.extend_from_slice(text.as_bytes());
    assert!(payload.len() <= 0xFF, "this probe writes short records only");
    let mut message = vec![0xD1, 0x01, 0x54, payload.len() as u8];
    message.extend_from_slice(&payload);
    message
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.iter().any(|a| a == "--yes-disposable") {
        eprintln!(
            "refusing to write: pass --yes-disposable and only with a Tag you are willing \
             to lose. The Tag's existing NDEF message is replaced."
        );
        std::process::exit(2);
    }

    let message = match args.iter().position(|a| a == "--message-hex") {
        Some(at) => {
            let raw = args.get(at + 1).cloned().unwrap_or_default();
            match pm4_studio_lib::reader::parse_hex(&raw) {
                Ok(bytes) if !bytes.is_empty() => bytes,
                _ => {
                    eprintln!("--message-hex needs an even number of hex digits");
                    std::process::exit(2);
                }
            }
        }
        None => text_record("en", PROBE_TEXT),
    };

    let reader = match Reader::open() {
        Ok(reader) => reader,
        Err(e) => {
            eprintln!("{e}");
            eprintln!(
                "if this is 0xE00002C5 another process holds the device — quit PM4 Studio \
                 and retry; do not kill anything."
            );
            std::process::exit(2);
        }
    };
    println!("opened {VID:04x}:{PID:04x}");
    println!(
        "message to write: {} bytes  ({} pages of TLV plus overhead)",
        message.len(),
        pm4_studio_lib::ntag::wrap_ndef_message(&message).len().div_ceil(4)
    );
    println!("  message hex : {}", hex(&message));
    println!(
        "  TLV         : {}",
        hex(&pm4_studio_lib::ntag::wrap_ndef_message(&message))
    );
    println!("  tag selector: {DEFAULT_TAG_SELECTOR} (0x0082 refuses the 5 that 0x0083 reports)");

    println!("\n== what the Tag holds now (a read; nothing is written yet) ==");
    let checked = ntag::preview(&reader, &message);
    match &checked.tag {
        Some(tag) => {
            println!("  UID                 : {}", tag.uid);
            println!("  0x0083 tag type     : {}", tag.reported_tag_type);
            println!(
                "  capacity from CC    : {}",
                tag.capacity_bytes
                    .map(|b| format!("{b} bytes"))
                    .unwrap_or_else(|| "unknown (not a Type 2 Capability Container)".into())
            );
            println!("  holds now           : {} state", tag.existing.state);
            if let Some(hex) = &tag.existing.message_hex {
                println!("    message ({} bytes): {hex}", tag.existing.bytes);
            }
            if let Some(reason) = &tag.existing.reason {
                println!("    note: {reason}");
            }
        }
        None => println!("  no Tag read"),
    }
    println!(
        "  message needs       : {} bytes",
        checked.required_bytes
    );
    if let Some(refusal) = &checked.refusal {
        println!("\nRESULT: REFUSED — {refusal}");
        println!("Nothing was written.");
        std::process::exit(2);
    }
    println!("  would write         : pages start at 4, {} page(s)", checked.required_bytes.div_ceil(4));

    println!("\n== writing ==");
    let report = ntag::write_message(&reader, &message);
    println!("  outcome             : {}", report.outcome.as_str());
    if let Some(message) = &report.message {
        println!("  detail              : {message}");
    }
    println!("  pages asked for     : {:?}", report.wrote_pages);
    println!("  pages firmware wrote: {:?}", report.accepted_pages);
    if let Some(after) = &report.readback {
        println!("  read-back state     : {}", after.existing.state);
        println!("  read-back bytes     : {}", after.existing.bytes);
        if let Some(hex) = &after.existing.message_hex {
            println!("  read-back message   : {hex}");
            println!(
                "  read-back is the message that was written : {}",
                hex == &message_hex(&message)
            );
        }
    } else {
        println!("  read-back           : the Tag could not be read back");
    }

    // The verdict the ticket is asking for, stated as evidence rather than as a
    // claim: how many pages were in one request, how many the firmware reported
    // writing, and whether the read-back carried the message.
    let pages = report.wrote_pages.len();
    let confirmed = report.outcome == pm4_studio_lib::write_outcome::WriteOutcome::Verified;
    println!("\n== verdict ==");
    println!("  pages in one request: {pages}");
    println!(
        "  firmware reported   : {} page(s) written",
        report.accepted_pages.len()
    );
    if confirmed {
        println!(
            "  RESULT: MULTI-PAGE WRITE VERIFIED — {pages} page(s) written in one 0x0082 \
             request and read back as the message that was sent."
        );
    } else if report.outcome == pm4_studio_lib::write_outcome::WriteOutcome::Unverified {
        println!(
            "  RESULT: MULTI-PAGE WRITE UNVERIFIED — the request was sent and the Tag did \
             not read back as the message; treat the Tag as unknown and re-read it."
        );
    } else if report.outcome == pm4_studio_lib::write_outcome::WriteOutcome::Failed {
        println!("  RESULT: WRITE FAILED — nothing was written.");
    } else {
        println!("  RESULT: REFUSED — nothing was written.");
    }

    match report.outcome {
        pm4_studio_lib::write_outcome::WriteOutcome::Verified => std::process::exit(0),
        pm4_studio_lib::write_outcome::WriteOutcome::Unverified => std::process::exit(1),
        _ => std::process::exit(2),
    }
}

fn message_hex(message: &[u8]) -> String {
    hex(message)
}

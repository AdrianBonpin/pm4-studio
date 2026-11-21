//! Hardware probe: erase a 13.56 MHz Tag's NDEF content.
//!
//! This is ticket 20's probe. It runs the shipping code path
//! (`pm4_studio_lib::ntag`) against a real Tag and prints the bytes that matter:
//!
//!   * what the Tag held before (UID, capacity, NDEF state, message hex);
//!   * the exact `0x0082` request frame, hex, so the evidence is auditable rather
//!     than a claim;
//!   * the outcome, the pages the firmware reported writing, and whether pages
//!     0..3 (UID, lock bytes, Capability Container) read back unchanged;
//!   * the user memory read back afterwards, page by page.
//!
//! Usage (from src-tauri/):
//!
//!   cargo run --example ndeferase -- --yes-disposable
//!
//! `--yes-disposable` is required: the Tag's NDEF message is cleared. Only run
//! this with a Tag you are willing to reuse. Erasing does not lock the Tag, does
//! not change its format, and does not touch a password — it writes an empty
//! NDEF TLV (`03 00 FE`) over the message area, pages 4 onwards.
//!
//! Exits 0 when the read-back showed a present Tag with no Records, 1 when the
//! erase was sent and not confirmed, 2 when nothing was erased or the probe could
//! not run.

use pm4_studio_lib::ntag::{self, EMPTY_NDEF_TLV, USER_FIRST_PAGE};
use pm4_studio_lib::reader::{hex, Reader, VID, PID};
use pm4_studio_lib::write_outcome::WriteOutcome;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !args.iter().any(|a| a == "--yes-disposable") {
        eprintln!(
            "refusing to erase: pass --yes-disposable and only with a Tag whose content you \
             are willing to lose. An erase clears the Tag's NDEF message."
        );
        std::process::exit(2);
    }

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
        "erase = write {} over the message area, pages {USER_FIRST_PAGE} onwards",
        hex(&EMPTY_NDEF_TLV)
    );

    println!("\n== what the Tag holds now (a read; nothing is written yet) ==");
    let preview = ntag::preview_erase(&reader);
    match &preview.tag {
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
            if let Some(message) = &tag.existing.message_hex {
                println!("    message ({} bytes): {message}", tag.existing.bytes);
            }
            if let Some(reason) = &tag.existing.reason {
                println!("    note: {reason}");
            }
        }
        None => println!("  no Tag read"),
    }
    println!("  would clear         : {} bytes", preview.clears_bytes);
    println!(
        "  would write         : {} page(s) {:?}",
        preview.pages.len(),
        preview.pages
    );
    if let Some(refusal) = &preview.refusal {
        println!("\nRESULT: REFUSED — {refusal}");
        println!("Nothing was written.");
        std::process::exit(2);
    }

    println!("\n== erasing ==");
    let report = ntag::erase_ndef(&reader);
    println!("  outcome             : {}", report.outcome.as_str());
    if let Some(message) = &report.message {
        println!("  detail              : {message}");
    }
    println!(
        "  request frame       : {} bytes",
        report.request_hex.split(' ').count()
    );
    println!("  request hex         : {}", report.request_hex);
    println!("  bytes over message  : {}", report.written_hex);
    println!(
        "  reply status        : {}",
        report
            .reply_status
            .map(|s| s.to_string())
            .unwrap_or_else(|| "no final 0x0082 frame".into())
    );
    println!("  reply frames        : {} frame(s)", report.reply_frames.len());
    for frame in &report.reply_frames {
        println!("    {frame}");
    }
    println!("  pages asked for     : {:?}", report.erase_pages);
    println!("  pages firmware wrote: {:?}", report.accepted_pages);
    println!(
        "  UID + CC intact     : {}",
        match report.identity_intact {
            Some(true) => "yes — pages 0..3 read identically",
            Some(false) => "NO — pages 0..3 changed",
            None => "unknown — no before/after pair",
        }
    );
    println!("  cleared             : {} bytes of NDEF content", report.cleared_bytes);
    match &report.readback {
        Some(after) => {
            println!("  read-back state     : {}", after.existing.state);
            println!("  read-back content   : {} bytes", after.existing.bytes);
            if let Some(message) = &after.existing.message_hex {
                println!("  read-back message   : {message}");
            }
            println!("  read-back UID       : {}", after.uid);
            println!(
                "  read-back capacity  : {}",
                after.capacity_bytes
                    .map(|b| format!("{b} bytes"))
                    .unwrap_or_else(|| "unknown".into())
            );
        }
        None => println!("  read-back           : the Tag could not be read back"),
    }

    // The pages that decide the question, straight off the Tag: if the erase
    // worked, pages 0..3 are byte-identical and page 4 starts with 03 00 FE.
    println!("\n== pages 0..8 as the Tag reads them now (verbatim) ==");
    match ntag::read_tag(&reader) {
        Ok(Some(after)) => {
            for page in 0..=8 {
                let bytes = match after.memory.page(page) {
                    Some(bytes) => hex(&bytes),
                    None => "(not in the reply)".to_string(),
                };
                println!("  page {page:>3} : {bytes}");
            }
        }
        Ok(None) => println!("  no Tag latched for the confirmation read"),
        Err(e) => println!("  the confirmation read failed: {e}"),
    }

    println!("\n== verdict ==");
    match report.outcome {
        WriteOutcome::Erased => {
            println!(
                "  RESULT: ERASED — the Tag reads back as present with a valid empty NDEF \
                 TLV and pages 0..3 unchanged, so its content is cleared and its format is \
                 intact. Not 'verified': clearing content places no copy."
            );
            std::process::exit(0);
        }
        WriteOutcome::Unverified => {
            println!(
                "  RESULT: UNVERIFIED — the erase was sent and the Tag did not read back, so \
                 what it holds is unknown. Re-read the Tag; do not assume either way."
            );
            std::process::exit(1);
        }
        WriteOutcome::Refused => {
            println!("  RESULT: REFUSED — nothing was written.");
            std::process::exit(2);
        }
        other => {
            println!("  RESULT: NOT ERASED ({}) — {}", other.as_str(), report.message.clone().unwrap_or_default());
            std::process::exit(2);
        }
    }
}

//! Instrument for PROTOCOL.md open problem 7: does a tag accept a second write,
//! and does the payload's leading `01 01` pair decide it?
//!
//! Not a shipping path — a probe, in the same family as `probe`, `clearprobe` and
//! `writeprobe`. Answers one question on hardware: the app sends
//! `payload[1] = 0x01, payload[2] = 0x01` on every write, the T5577 transmits its
//! per-block lock bit inside the same standard-write command as the data, and no
//! tag has ever been observed taking a second write. Either the flags are the
//! lock, or these tags lock after one write for their own reasons.
//!
//! Usage: cargo run --example lockprobe -- <flags|noflags> [customer] [hexdata32]
//!   writes identity A, re-reads, writes identity B, re-reads — reporting each.

use pm4_studio_lib::identity::TagPresence;
use pm4_studio_lib::reader::{make_frame, Reader};
use std::thread::sleep;
use std::time::Duration;

const CMD_LF_WRITE: u16 = 0x0073;

fn read(reader: &Reader) -> TagPresence {
    for attempt in 0..10 {
        if attempt > 0 {
            sleep(Duration::from_millis(200));
        }
        reader.wake().ok();
        match reader.lf_read_presence_once() {
            Ok(TagPresence::Absent) => continue,
            Ok(found) => return found,
            Err(e) => {
                println!("  read error: {e}");
                return TagPresence::Unreadable;
            }
        }
    }
    TagPresence::Absent
}

fn describe(presence: TagPresence) -> String {
    match presence {
        TagPresence::Absent => "no tag latched".to_string(),
        TagPresence::Unreadable => "reply too short to decode".to_string(),
        TagPresence::Blank => "tag present, NO identity".to_string(),
        TagPresence::Identified(identity) => format!("tag present as {}", identity.id()),
    }
}

/// The 24-byte write payload. `flags` decides whether the leading `01 01` pair
/// the shipping code always sends is included.
fn payload(customer: u8, data32: u32, flags: bool) -> [u8; 24] {
    let mut p = [0u8; 24];
    if flags {
        p[1] = 0x01;
        p[2] = 0x01;
    }
    p[8] = customer;
    p[12] = customer;
    p[16..20].copy_from_slice(&data32.to_le_bytes());
    p
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let flags = match args.first().map(String::as_str) {
        Some("flags") => true,
        Some("noflags") => false,
        _ => {
            eprintln!("usage: lockprobe <flags|noflags> [customer] [hexdata32]");
            std::process::exit(2);
        }
    };
    let customer = args
        .get(1)
        .map(|v| u8::from_str_radix(v.trim_start_matches("0x"), 16).expect("customer hex"))
        .unwrap_or(0x12);
    let base = args
        .get(2)
        .map(|v| u32::from_str_radix(v.trim_start_matches("0x"), 16).expect("data32 hex"))
        .unwrap_or(0x0000_A001);

    let reader = match Reader::open() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("open failed: {e}");
            std::process::exit(1);
        }
    };

    println!("payload flags: {}", if flags { "01 01 (as the app sends)" } else { "none (flags cleared)" });
    println!("before       : {}", describe(read(&reader)));

    for (attempt, data32) in [(1, base), (2, base | 0x1)].iter() {
        let bytes = payload(customer, *data32, flags);
        let frame = make_frame(CMD_LF_WRITE, &bytes);
        println!("\n--- write {attempt} -> customer {customer:02X} data32 {data32:08X} ---");
        match reader.raw_command(&frame) {
            Ok(_) => println!("  transmitted : ok"),
            Err(e) => {
                println!("  transmitted : FAILED — {e}");
                continue;
            }
        }
        sleep(Duration::from_millis(500));
        let after = read(&reader);
        println!("  after       : {}", describe(after));
        if let TagPresence::Identified(id) = after {
            if id.customer == customer && id.data32 == *data32 {
                println!("  RESULT      : write {attempt} TOOK");
                continue;
            }
        }
        println!("  RESULT      : write {attempt} DID NOT TAKE");
    }
}

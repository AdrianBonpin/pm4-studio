//! Read-only probe: the Records on one 13.56 MHz tag, through the shipping path.
//!
//! Calls the same `ntag` + `tag_records` code the app calls, so a hardware run
//! exercises the shipping read path rather than a parallel copy of it. It sends
//! `0x0083` (info) and `0x0081` (memory read) and nothing else: no write, no
//! erase, no format. Decoding the message into Records happens in the webview
//! codec, so this prints the outcome and the message bytes it hands over.
//!
//! Usage, from src-tauri/:
//!
//!   cargo run --example recordsread
//!
//! A tag that is not on the Reader, or a Reader another process holds, prints
//! the error the page would show and exits non-zero.

use pm4_studio_lib::ntag;
use pm4_studio_lib::reader::Reader;
use pm4_studio_lib::tag_records::TagNdef;

fn main() {
    let reader = match Reader::open() {
        Ok(reader) => reader,
        Err(e) => {
            eprintln!("{e}");
            if e.contains("E00002C5") {
                eprintln!("the Reader is held by another process — quit it and retry");
            }
            std::process::exit(2);
        }
    };

    let read = (|| -> Result<TagNdef, String> {
        let info = ntag::read_info(&reader)?;
        println!("tag type {}  UID {}", info.tag_type, info.uid);
        let payload = ntag::read_payload(&reader, &info)?;
        TagNdef::from_read_payload(&payload).map_err(|e| e.message())
    })();

    match read {
        Ok(ndef) => {
            println!("outcome: {}", ndef.outcome);
            println!(
                "capability container: {}  user memory: {} bytes in {} pages",
                ndef.capability_container_hex,
                ndef.user_memory_bytes,
                ndef.user_pages.unwrap_or(0)
            );
            if let Some(reason) = &ndef.reason {
                println!("reason: {reason}");
            }
            println!("message ({} bytes): {}", ndef.message_bytes, ndef.message_hex);
            println!(
                "user memory as read: {}",
                ndef.user_memory_hex.split(' ').take(48).collect::<Vec<_>>().join(" ")
            );
        }
        Err(e) => {
            eprintln!("not read: {e}");
            std::process::exit(1);
        }
    }
}
